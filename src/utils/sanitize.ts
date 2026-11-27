/**
 * Escapes a CSV cell per RFC-4180 and neutralizes spreadsheet formula injection.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const needsPrefix = /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?%?$/.test(raw);
  const safe = needsPrefix ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Validates that an external document URL uses http: or https: only.
 */
export function isSafeHttpUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
