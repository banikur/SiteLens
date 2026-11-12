import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticatorTransport,
} from '@simplewebauthn/server';
import { getDb } from '../db/index.ts';
import { users, sessions, webauthnCredentials } from '../db/schema.ts';
import {
  hashSecret,
  verifySecret,
  generateSessionToken,
  hashSessionToken,
} from '../auth/crypto.ts';
import {
  requireAuth,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from '../auth/middleware.ts';

export const authRouter = Router();

const RP_NAME = 'SiteLens';
const getRpId = () => process.env.RP_ID || 'localhost';
const getRpOrigin = () => process.env.RP_ORIGIN || 'http://localhost:3000';

// Short-lived challenge store (5 minute TTL)
const challengeStore = new Map<
  string,
  { challenge: string; userId?: string; expiresAt: number }
>();

// Rate limit store for PIN attempts (5 attempts / 5 minutes)
const pinAttempts = new Map<string, { count: number; resetAt: number }>();

function storeChallenge(key: string, challenge: string, userId?: string) {
  challengeStore.set(key, {
    challenge,
    userId,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
}

function consumeChallenge(key: string) {
  const entry = challengeStore.get(key);
  challengeStore.delete(key);
  if (!entry || entry.expiresAt < Date.now()) {
    return null;
  }
  return entry;
}

function checkPinRateLimit(rateKey: string): boolean {
  const now = Date.now();
  const entry = pinAttempts.get(rateKey);
  if (!entry || entry.resetAt < now) {
    pinAttempts.set(rateKey, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 5) {
    return false;
  }
  entry.count += 1;
  return true;
}

async function createSessionCookie(res: Response, userId: string) {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    id: tokenHash,
    userId,
    expiresAt,
  });

  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  });
}

function sanitizeUser(u: typeof users.$inferSelect, passkeysCount = 0) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    role: u.role,
    title: u.title,
    avatar: u.avatar,
    assignedProjects: u.assignedProjects,
    certifications: u.certifications,
    hasPin: Boolean(u.pinHash),
    passkeysCount,
  };
}

authRouter.get('/me', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.status(401).json({ authenticated: false, user: null });
    return;
  }

  const db = getDb();
  let passkeysCount = 0;
  if (db) {
    const creds = await db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, req.authUser.id));
    passkeysCount = creds.length;
  }

  res.json({
    authenticated: true,
    user: { ...req.authUser, passkeysCount },
  });
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username.trim()))
    .limit(1);

  if (!user || !user.isActive || !verifySecret(password, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  await createSessionCookie(res, user.id);
  const creds = await db
    .select({ id: webauthnCredentials.id })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, user.id));

  res.json({ user: sanitizeUser(user, creds.length) });
});

authRouter.post('/pin-login', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  const { username, pin } = req.body ?? {};
  if (typeof username !== 'string' || typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
    res.status(400).json({ error: 'Valid username and 4-6 digit PIN are required.' });
    return;
  }

  const rateKey = `${req.ip}:${username.trim().toLowerCase()}`;
  if (!checkPinRateLimit(rateKey)) {
    res.status(429).json({ error: 'Too many PIN attempts. Please wait 5 minutes or use password.' });
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username.trim()))
    .limit(1);

  if (!user || !user.isActive || !verifySecret(pin, user.pinHash)) {
    res.status(401).json({ error: 'Invalid username or PIN.' });
    return;
  }

  pinAttempts.delete(rateKey);
  await createSessionCookie(res, user.id);
  const creds = await db
    .select({ id: webauthnCredentials.id })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, user.id));

  res.json({ user: sanitizeUser(user, creds.length) });
});

authRouter.post('/pin-setup', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  const { pin } = req.body ?? {};
  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
    res.status(400).json({ error: 'PIN must be 4 to 6 numeric digits.' });
    return;
  }

  await db
    .update(users)
    .set({ pinHash: hashSecret(pin) })
    .where(eq(users.id, req.authUser.id));

  res.json({ success: true, hasPin: true });
});

authRouter.post('/logout', async (req: Request, res: Response) => {
  const db = getDb();
  if (db && req.sessionId) {
    await db.delete(sessions).where(eq(sessions.id, req.sessionId));
  }
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

authRouter.post('/webauthn/register-options', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  const existingCreds = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, req.authUser.id));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpId(),
    userName: req.authUser.username,
    userDisplayName: req.authUser.name,
    attestationType: 'none',
    excludeCredentials: existingCreds.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });

  storeChallenge(`reg:${req.authUser.id}`, options.challenge, req.authUser.id);
  res.json(options);
});

authRouter.post('/webauthn/register-verify', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  const challengeEntry = consumeChallenge(`reg:${req.authUser.id}`);
  if (!challengeEntry) {
    res.status(400).json({ error: 'Registration challenge expired or missing.' });
    return;
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge: challengeEntry.challenge,
      expectedOrigin: getRpOrigin(),
      expectedRPID: getRpId(),
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: 'Biometric registration verification failed.' });
      return;
    }

    const { credential } = verification.registrationInfo;
    await db.insert(webauthnCredentials).values({
      id: crypto.randomUUID(),
      userId: req.authUser.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? ['internal'],
      deviceName: typeof req.body.deviceName === 'string' && req.body.deviceName.trim()
        ? req.body.deviceName.trim()
        : 'Field Device Biometric',
    });

    res.json({ verified: true });
  } catch (err: any) {
    console.error('WebAuthn register verify error:', err);
    res.status(400).json({ error: err?.message || 'Failed to verify biometric credential.' });
  }
});

authRouter.post('/webauthn/login-options', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  const { username } = req.body ?? {};
  let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] | undefined;

  if (typeof username === 'string' && username.trim()) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username.trim()))
      .limit(1);

    if (user) {
      const creds = await db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, user.id));
      allowCredentials = creds.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransport[],
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: 'preferred',
    allowCredentials,
  });

  const challengeToken = crypto.randomUUID();
  storeChallenge(`auth:${challengeToken}`, options.challenge);
  res.json({ options, challengeToken });
});

authRouter.post('/webauthn/login-verify', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  const { challengeToken, response } = req.body ?? {};
  if (typeof challengeToken !== 'string' || !response?.id) {
    res.status(400).json({ error: 'Invalid biometric login payload.' });
    return;
  }

  const challengeEntry = consumeChallenge(`auth:${challengeToken}`);
  if (!challengeEntry) {
    res.status(400).json({ error: 'Authentication challenge expired or missing.' });
    return;
  }

  const [cred] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, response.id))
    .limit(1);

  if (!cred) {
    res.status(401).json({ error: 'Unrecognized biometric credential.' });
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, cred.userId))
    .limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: 'User account is inactive or missing.' });
    return;
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeEntry.challenge,
      expectedOrigin: getRpOrigin(),
      expectedRPID: getRpId(),
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')),
        counter: cred.counter,
        transports: cred.transports as AuthenticatorTransport[],
      },
    });

    if (!verification.verified) {
      res.status(401).json({ error: 'Biometric verification failed.' });
      return;
    }

    await db
      .update(webauthnCredentials)
      .set({ counter: verification.authenticationInfo.newCounter })
      .where(eq(webauthnCredentials.id, cred.id));

    await createSessionCookie(res, user.id);
    const allCreds = await db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, user.id));

    res.json({ user: sanitizeUser(user, allCreds.length) });
  } catch (err: any) {
    console.error('WebAuthn login verify error:', err);
    res.status(400).json({ error: err?.message || 'Biometric login failed.' });
  }
});
