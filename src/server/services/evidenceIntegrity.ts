import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const EVIDENCE_INTEGRITY_VERSION = 1;
export const EVIDENCE_URL_PREFIX = '/api/uploads/';

const EVIDENCE_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface EvidenceGps {
  latitude: number;
  longitude: number;
  altitudeMeters?: number;
  accuracyMeters?: number;
}

export interface EvidenceExif {
  gps?: EvidenceGps;
  capturedAt?: string;
  make?: string;
  model?: string;
}

export interface EvidenceManifest {
  integrityVersion: number;
  filename: string;
  originalName?: string;
  mimeType: ImageMime;
  size: number;
  sha256: string;
  clientSha256?: string;
  clientSha256Matched?: boolean;
  capturedAt?: string;
  capturedAtSource?: 'exif' | 'client';
  gps?: EvidenceGps;
  gpsSource?: 'exif' | 'client' | 'none';
  exif?: { make?: string; model?: string };
  uploadedById: string;
  uploadedByName: string;
  uploadedAt: string;
}

export interface EvidenceVerification {
  ok: boolean;
  reason?:
    | 'missing_file'
    | 'missing_manifest'
    | 'hash_mismatch'
    | 'invalid_filename'
    | 'read_error';
  manifest?: EvidenceManifest;
  currentSha256?: string;
}

let cachedUploadDir: string | null = null;

export function getUploadDir(): string {
  if (!cachedUploadDir) {
    cachedUploadDir = path.resolve(
      process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
    );
    fs.mkdirSync(cachedUploadDir, { recursive: true });
  }
  return cachedUploadDir;
}

export function isEvidenceFilename(name: string): boolean {
  return EVIDENCE_FILENAME_RE.test(name);
}

/**
 * Returns the stored filename when `url` is a local evidence URL, otherwise null.
 * Only the canonical `/api/uploads/<uuid>.<ext>` shape is accepted so callers can
 * never be tricked into reading an arbitrary path.
 */
export function extractEvidenceFilename(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(EVIDENCE_URL_PREFIX)) return null;
  const rest = url.slice(EVIDENCE_URL_PREFIX.length);
  if (rest.includes('/') || rest.includes('?') || rest.includes('#')) return null;
  return isEvidenceFilename(rest) ? rest : null;
}

export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256File(filePath: string): string {
  return sha256Buffer(fs.readFileSync(filePath));
}

/**
 * Detects the real image type from magic bytes instead of trusting the
 * client-supplied `Content-Type`, which is trivially spoofable.
 */
export function sniffImageMime(buf: Buffer): ImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// ---------------------------------------------------------------------------
// EXIF (JPEG APP1) parsing — pure, dependency-free, bounded reads only.
// ---------------------------------------------------------------------------

interface TiffEntry {
  type: number;
  count: number;
  valueOffset: number;
  entryOffset: number;
}

interface TiffReader {
  buffer: Buffer;
  little: boolean;
  u16(offset: number): number;
  u32(offset: number): number;
}

const TIFF_TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

function extractExifPayload(jpeg: Buffer): Buffer | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= jpeg.length) {
    if (jpeg[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = jpeg[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;

    if (offset + 4 > jpeg.length) break;
    const segmentLength = jpeg.readUInt16BE(offset + 2);
    if (segmentLength < 2) break;

    const payloadStart = offset + 4;
    const payloadEnd = offset + 2 + segmentLength;
    if (payloadEnd > jpeg.length) break;

    if (marker === 0xe1) {
      const payload = jpeg.subarray(payloadStart, payloadEnd);
      if (
        payload.length >= 6 &&
        payload[0] === 0x45 && // E
        payload[1] === 0x78 && // x
        payload[2] === 0x69 && // i
        payload[3] === 0x66 && // f
        payload[4] === 0x00 &&
        payload[5] === 0x00
      ) {
        return payload;
      }
    }

    offset = payloadEnd;
  }

  return null;
}

function createTiffReader(payload: Buffer): TiffReader | null {
  // payload starts with "Exif\0\0"; TIFF header follows.
  const tiff = payload.subarray(6);
  if (tiff.length < 8) return null;

  const byteOrder = tiff.toString('ascii', 0, 2);
  const little = byteOrder === 'II';
  if (!little && byteOrder !== 'MM') return null;

  const reader: TiffReader = {
    buffer: tiff,
    little,
    u16: (offset) =>
      little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset),
    u32: (offset) =>
      little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset),
  };

  if (reader.u16(2) !== 42) return null;
  return reader;
}

function readIfd(reader: TiffReader, offset: number): Map<number, TiffEntry> {
  const entries = new Map<number, TiffEntry>();
  const { buffer } = reader;

  if (!Number.isFinite(offset) || offset < 8 || offset + 2 > buffer.length) {
    return entries;
  }

  const count = reader.u16(offset);
  if (count <= 0 || count > 1024) return entries;

  for (let i = 0; i < count; i += 1) {
    const entryOffset = offset + 2 + i * 12;
    if (entryOffset + 12 > buffer.length) break;

    const tag = reader.u16(entryOffset);
    if (tag === 0) continue;

    entries.set(tag, {
      type: reader.u16(entryOffset + 2),
      count: reader.u32(entryOffset + 4),
      valueOffset: reader.u32(entryOffset + 8),
      entryOffset,
    });
  }

  return entries;
}

function valueLocation(reader: TiffReader, entry: TiffEntry): number {
  const byteLength = (TIFF_TYPE_SIZE[entry.type] ?? 1) * entry.count;
  return byteLength <= 4 ? entry.entryOffset + 8 : entry.valueOffset;
}

function readAscii(reader: TiffReader, entry: TiffEntry | undefined): string | undefined {
  if (!entry || entry.count === 0 || entry.count > 512) return undefined;
  const location = valueLocation(reader, entry);
  if (location < 0 || location + entry.count > reader.buffer.length) return undefined;
  return reader.buffer
    .toString('latin1', location, location + entry.count)
    .replace(/\0+$/g, '')
    .trim();
}

function readByte(reader: TiffReader, entry: TiffEntry | undefined): number | undefined {
  if (!entry) return undefined;
  const location = valueLocation(reader, entry);
  if (location < 0 || location >= reader.buffer.length) return undefined;
  return reader.buffer[location];
}

function readRationals(reader: TiffReader, entry: TiffEntry | undefined): number[] {
  if (!entry || entry.count === 0 || entry.count > 8) return [];
  const location = valueLocation(reader, entry);
  const values: number[] = [];

  for (let i = 0; i < entry.count; i += 1) {
    const offset = location + i * 8;
    if (offset < 0 || offset + 8 > reader.buffer.length) break;
    const numerator = reader.u32(offset);
    const denominator = reader.u32(offset + 4);
    if (denominator === 0) break;
    values.push(numerator / denominator);
  }

  return values;
}

function normalizeExifDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export function parseExif(jpeg: Buffer): EvidenceExif {
  try {
    const payload = extractExifPayload(jpeg);
    if (!payload) return {};

    const reader = createTiffReader(payload);
    if (!reader) return {};

    const ifd0 = readIfd(reader, reader.u32(4));
    const make = readAscii(reader, ifd0.get(0x010f));
    const model = readAscii(reader, ifd0.get(0x0110));

    let capturedAt = normalizeExifDate(readAscii(reader, ifd0.get(0x0132)));

    const exifPointer = ifd0.get(0x8769);
    if (exifPointer) {
      const exifIfd = readIfd(reader, reader.u32(exifPointer.entryOffset + 8));
      const dateOriginal = normalizeExifDate(readAscii(reader, exifIfd.get(0x9003)));
      if (dateOriginal) capturedAt = dateOriginal;
    }

    let gps: EvidenceGps | undefined;
    const gpsPointer = ifd0.get(0x8825);
    if (gpsPointer) {
      const gpsIfd = readIfd(reader, reader.u32(gpsPointer.entryOffset + 8));

      const latValues = readRationals(reader, gpsIfd.get(0x0002));
      const lonValues = readRationals(reader, gpsIfd.get(0x0004));

      if (latValues.length === 3 && lonValues.length === 3) {
        let latitude = latValues[0] + latValues[1] / 60 + latValues[2] / 3600;
        let longitude = lonValues[0] + lonValues[1] / 60 + lonValues[2] / 3600;

        const latRef = readAscii(reader, gpsIfd.get(0x0001));
        const lonRef = readAscii(reader, gpsIfd.get(0x0003));
        if (latRef?.toUpperCase() === 'S') latitude = -latitude;
        if (lonRef?.toUpperCase() === 'W') longitude = -longitude;

        const altitudeValues = readRationals(reader, gpsIfd.get(0x0006));
        let altitudeMeters: number | undefined;
        if (altitudeValues.length === 1) {
          const altRef = readByte(reader, gpsIfd.get(0x0005));
          altitudeMeters = altRef === 1 ? -altitudeValues[0] : altitudeValues[0];
        }

        if (
          Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          Math.abs(latitude) <= 90 &&
          Math.abs(longitude) <= 180 &&
          !(latitude === 0 && longitude === 0)
        ) {
          gps = { latitude, longitude };
          if (altitudeMeters !== undefined && Number.isFinite(altitudeMeters)) {
            gps.altitudeMeters = altitudeMeters;
          }
        }
      }
    }

    const exif: EvidenceExif = {};
    if (gps) exif.gps = gps;
    if (capturedAt) exif.capturedAt = capturedAt;
    if (make) exif.make = make;
    if (model) exif.model = model;
    return exif;
  } catch {
    // Malformed EXIF must never break an upload; it only means "no metadata".
    return {};
  }
}

// ---------------------------------------------------------------------------
// Manifest storage — a sidecar JSON written next to every stored evidence file.
// ---------------------------------------------------------------------------

export function manifestPath(dir: string, filename: string): string {
  return path.join(dir, `${filename}.manifest.json`);
}

export function writeManifestSync(
  dir: string,
  filename: string,
  manifest: EvidenceManifest
): void {
  fs.writeFileSync(manifestPath(dir, filename), JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });
}

export function readManifestSync(dir: string, filename: string): EvidenceManifest | null {
  try {
    const raw = fs.readFileSync(manifestPath(dir, filename), 'utf8');
    const parsed = JSON.parse(raw) as EvidenceManifest;
    if (!parsed || typeof parsed.sha256 !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Recomputes the hash of a stored evidence file and compares it with the hash
 * recorded at upload time. This is what makes the "tamper-evident" claim real:
 * a file swapped on disk no longer matches its manifest.
 */
export function verifyStoredEvidence(
  dir: string,
  filename: string
): EvidenceVerification {
  if (!isEvidenceFilename(filename)) {
    return { ok: false, reason: 'invalid_filename' };
  }

  const fullPath = path.join(dir, filename);
  if (!fs.existsSync(fullPath)) {
    return { ok: false, reason: 'missing_file' };
  }

  const manifest = readManifestSync(dir, filename);
  if (!manifest) {
    return { ok: false, reason: 'missing_manifest' };
  }

  try {
    const currentSha256 = sha256File(fullPath);
    if (currentSha256 !== manifest.sha256) {
      return { ok: false, reason: 'hash_mismatch', manifest, currentSha256 };
    }
    return { ok: true, manifest, currentSha256 };
  } catch {
    return { ok: false, reason: 'read_error', manifest };
  }
}

export function isValidGps(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}
