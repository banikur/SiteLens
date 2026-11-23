import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { requireAuth } from '../auth/middleware.ts';
import { requirePermission, PERMISSIONS } from '../auth/rbac.ts';
import {
  EVIDENCE_INTEGRITY_VERSION,
  EVIDENCE_URL_PREFIX,
  getUploadDir,
  isValidGps,
  isEvidenceFilename,
  parseExif,
  sha256Buffer,
  sniffImageMime,
  verifyStoredEvidence,
  writeManifestSync,
  type EvidenceManifest,
  type EvidenceGps,
  type ImageMime,
} from '../services/evidenceIntegrity.ts';

export const uploadsRouter = Router();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXT_BY_MIME: Record<ImageMime, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

// Files are held in memory first so we can verify the real content (magic
// bytes + SHA-256 + EXIF) *before* anything is written to disk. A client can
// claim any Content-Type it likes; only the bytes are trusted.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
});

const SHA256_RE = /^[a-f0-9]{64}$/i;

function parseClientSha(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return SHA256_RE.test(trimmed) ? trimmed : null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseClientDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // Reject absurd timestamps (e.g. year 1970 or year 3000 claims).
  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > 2100) return undefined;
  return parsed.toISOString();
}

function resolveClientGps(body: Record<string, unknown>): EvidenceGps | undefined {
  const latitude = parseNumber(body.lat ?? body.latitude);
  const longitude = parseNumber(body.lng ?? body.lon ?? body.longitude);
  if (!isValidGps(latitude, longitude)) return undefined;

  const gps: EvidenceGps = { latitude: latitude as number, longitude: longitude as number };
  const accuracy = parseNumber(body.accuracy);
  if (accuracy !== null && accuracy >= 0 && accuracy <= 100000) {
    gps.accuracyMeters = accuracy;
  }
  return gps;
}

function buildManifest(
  filename: string,
  buffer: Buffer,
  mimeType: ImageMime,
  body: Record<string, unknown>,
  req: Request
): { manifest: EvidenceManifest; clientSha256: string | null; hashMismatch: boolean } {
  const serverSha256 = sha256Buffer(buffer);
  const clientSha256 = parseClientSha(body.sha256);
  const exif = mimeType === 'image/jpeg' ? parseExif(buffer) : {};

  // EXIF is authoritative because it travels inside the image bytes and cannot
  // be altered without changing the SHA-256. Client GPS/timestamp is only a
  // fallback for images whose EXIF was stripped, and is labelled as such.
  const gps = exif.gps ?? resolveClientGps(body);
  const gpsSource: EvidenceManifest['gpsSource'] = exif.gps
    ? 'exif'
    : gps
    ? 'client'
    : 'none';

  const capturedAt = exif.capturedAt ?? parseClientDate(body.capturedAt);
  const capturedAtSource: EvidenceManifest['capturedAtSource'] = exif.capturedAt
    ? 'exif'
    : capturedAt
    ? 'client'
    : undefined;

  const originalName = typeof body.originalName === 'string' ? body.originalName : undefined;

  const manifest: EvidenceManifest = {
    integrityVersion: EVIDENCE_INTEGRITY_VERSION,
    filename,
    originalName: originalName ? path.basename(originalName).slice(0, 200) : undefined,
    mimeType,
    size: buffer.length,
    sha256: serverSha256,
    clientSha256: clientSha256 ?? undefined,
    clientSha256Matched: clientSha256 ? clientSha256 === serverSha256 : undefined,
    capturedAt,
    capturedAtSource,
    gps,
    gpsSource,
    exif: exif.make || exif.model ? { make: exif.make, model: exif.model } : undefined,
    uploadedById: req.authUser?.id ?? 'unknown',
    uploadedByName: req.authUser?.name ?? 'unknown',
    uploadedAt: new Date().toISOString(),
  };

  return {
    manifest,
    clientSha256,
    hashMismatch: Boolean(clientSha256 && clientSha256 !== serverSha256),
  };
}

function handleUpload(req: Request, res: Response) {
  if (!req.file) {
    res.status(400).json({ error: 'No image file uploaded.' });
    return;
  }

  const mimeType = sniffImageMime(req.file.buffer);
  if (!mimeType) {
    res.status(415).json({
      error: 'Unsupported or spoofed file. Only real JPEG, PNG, and WebP images are accepted.',
    });
    return;
  }

  const filename = `${crypto.randomUUID()}${EXT_BY_MIME[mimeType]}`;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { manifest, clientSha256, hashMismatch } = buildManifest(
    filename,
    req.file.buffer,
    mimeType,
    body,
    req
  );

  // A client that declares a hash which disagrees with the bytes it sent is
  // either corrupt or tampering; refuse rather than silently storing it.
  if (hashMismatch) {
    res.status(409).json({
      error: 'Client SHA-256 does not match the uploaded bytes. Upload rejected.',
      expectedSha256: manifest.sha256,
      clientSha256,
    });
    return;
  }

  const uploadDir = path.resolve(getUploadDir());
  const safeFilename = path.basename(filename);
  if (!/^[A-Za-z0-9._-]+$/.test(safeFilename)) {
    res.status(400).json({ error: 'Invalid filename.' });
    return;
  }
  const fullPath = path.resolve(uploadDir, safeFilename);
  if (!fullPath.startsWith(uploadDir + path.sep) && fullPath !== uploadDir) {
    res.status(400).json({ error: 'Invalid file destination path.' });
    return;
  }

  const fileBuffer = req.file.buffer;

  try {
    fs.writeFileSync(fullPath, fileBuffer, { mode: 0o600 });
    writeManifestSync(uploadDir, safeFilename, manifest);
  } catch (err) {
    try {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch {
      // Best-effort cleanup; the original failure is what matters.
    }
    console.error('Evidence write failed:', err);
    res.status(500).json({ error: 'Failed to store evidence file.' });
    return;
  }

  const url = `${EVIDENCE_URL_PREFIX}${filename}`;
  res.status(201).json({
    filename,
    url,
    size: manifest.size,
    sha256: manifest.sha256,
    integrityVersion: manifest.integrityVersion,
    manifestUrl: `${url}/integrity`,
    integrity: {
      verified: true,
      sha256: manifest.sha256,
      size: manifest.size,
      mimeType: manifest.mimeType,
      gps: manifest.gps,
      gpsSource: manifest.gpsSource,
      capturedAt: manifest.capturedAt,
      capturedAtSource: manifest.capturedAtSource,
      exif: manifest.exif,
      uploadedAt: manifest.uploadedAt,
    },
  });
}

uploadsRouter.post('/', requireAuth, requirePermission(PERMISSIONS.EVIDENCE_UPLOAD), (req: Request, res: Response) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Image exceeds the 10 MB limit.' });
        return;
      }
      res.status(400).json({ error: 'Malformed upload request.' });
      return;
    }
    try {
      handleUpload(req, res);
    } catch (error) {
      console.error('Unexpected upload error:', error);
      res.status(500).json({ error: 'Unexpected upload error.' });
    }
  });
});

// Integrity report for a single stored evidence file. This is the endpoint an
// auditor (or the inspection submitter) can call to prove the file on disk is
// byte-for-byte the file that was uploaded.
uploadsRouter.get('/:filename/integrity', requireAuth, (req: Request, res: Response) => {
  const filename = req.params.filename;
  if (!isEvidenceFilename(filename)) {
    res.status(400).json({ error: 'Invalid evidence filename.' });
    return;
  }

  const result = verifyStoredEvidence(getUploadDir(), filename);
  if (!result.manifest && result.reason === 'missing_file') {
    res.status(404).json({ error: 'Evidence file not found.', ok: false, reason: result.reason });
    return;
  }

  res.status(result.ok ? 200 : 409).json({
    ok: result.ok,
    reason: result.reason,
    url: `${EVIDENCE_URL_PREFIX}${filename}`,
    currentSha256: result.currentSha256,
    manifest: result.manifest,
  });
});

uploadsRouter.get('/:filename', requireAuth, (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);
  if (!isEvidenceFilename(filename)) {
    res.status(400).json({ error: 'Invalid evidence filename.' });
    return;
  }

  const uploadDir = getUploadDir();
  const fullPath = path.join(uploadDir, filename);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  const check = verifyStoredEvidence(uploadDir, filename);

  // A file whose hash no longer matches its manifest has been altered on disk.
  // Serving it would let forged evidence pass as the original, so refuse.
  if (!check.ok && check.reason === 'hash_mismatch') {
    res.setHeader('X-Evidence-Integrity', 'failed');
    res.status(409).json({
      error: 'Evidence integrity check failed: stored file no longer matches its upload manifest.',
    });
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  res.setHeader('X-Evidence-Integrity', check.ok ? 'verified' : 'unverified');
  if (check.manifest?.mimeType) {
    res.setHeader('Content-Type', check.manifest.mimeType);
  }
  res.sendFile(fullPath);
});
