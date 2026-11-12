import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';
import type { User } from '../types';

export interface AuthenticatedUser extends User {
  username: string;
  hasPin: boolean;
  passkeysCount: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'connected' | 'unconfigured' | 'error';
  aiConfigured: boolean;
}

export async function fetchHealth(): Promise<HealthStatus | null> {
  try {
    const res = await fetch('/api/health', { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchCurrentUser(): Promise<AuthenticatedUser | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user ?? null;
}

export async function loginWithPassword(
  username: string,
  password: string
): Promise<AuthenticatedUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Login failed.');
  }
  return data.user;
}

export async function loginWithPin(
  username: string,
  pin: string
): Promise<AuthenticatedUser> {
  const res = await fetch('/api/auth/pin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, pin }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'PIN login failed.');
  }
  return data.user;
}

export async function setupPin(pin: string): Promise<void> {
  const res = await fetch('/api/auth/pin-setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ pin }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to save PIN.');
  }
}

export async function registerBiometric(deviceName?: string): Promise<void> {
  const optRes = await fetch('/api/auth/webauthn/register-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  const options = await optRes.json();
  if (!optRes.ok) {
    throw new Error(options.error || 'Failed to start biometric registration.');
  }

  const attResp = await startRegistration({ optionsJSON: options });

  const verRes = await fetch('/api/auth/webauthn/register-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ response: attResp, deviceName }),
  });
  const verData = await verRes.json();
  if (!verRes.ok || !verData.verified) {
    throw new Error(verData.error || 'Biometric verification failed.');
  }
}

export async function loginWithBiometric(
  username?: string
): Promise<AuthenticatedUser> {
  const optRes = await fetch('/api/auth/webauthn/login-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username: username?.trim() || undefined }),
  });
  const { options, challengeToken, error } = await optRes.json();
  if (!optRes.ok) {
    throw new Error(error || 'Failed to start biometric login.');
  }

  const assertion = await startAuthentication({ optionsJSON: options });

  const verRes = await fetch('/api/auth/webauthn/login-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ challengeToken, response: assertion }),
  });
  const verData = await verRes.json();
  if (!verRes.ok) {
    throw new Error(verData.error || 'Biometric login failed.');
  }
  return verData.user;
}

export async function logoutSession(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });
}

