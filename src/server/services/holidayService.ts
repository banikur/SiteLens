import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import { nationalHolidays } from '../db/schema.ts';

const MONTH_MAP: Record<string, string> = {
  januari: '01',
  februari: '02',
  maret: '03',
  april: '04',
  mei: '05',
  juni: '06',
  juli: '07',
  agustus: '08',
  september: '09',
  oktober: '10',
  november: '11',
  desember: '12',
};

export interface ParsedHoliday {
  holidayDate: string; // YYYY-MM-DD
  name: string;
  year: number;
}

/**
 * Parses Indonesian national holidays from tanggalans.com HTML without extra DOM dependencies.
 * Adapted from radyakaze/api-hari-libur scraper structure.
 */
export function parseTanggalansHtml(html: string, fallbackYear: number): ParsedHoliday[] {
  const results: ParsedHoliday[] = [];
  const monthBlocks = html.split(/class=["'][^"']*kalender-indo[^"']*["']/i).slice(1);

  for (const block of monthBlocks) {
    const titleMatch = block.match(/class=["'][^"']*kal-title-link[^"']*["'][^>]*>([^<]+)</i);
    if (!titleMatch) continue;

    const parts = titleMatch[1].trim().split(/\s+/);
    const monthName = (parts[0] || '').toLowerCase();
    const yearNum = Number(parts[1]) || fallbackYear;
    const month = MONTH_MAP[monthName];
    if (!month) continue;

    const listMatch = block.match(/class=["'][^"']*kal-libur-list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i);
    if (!listMatch) continue;

    const liRegex = /<li[^>]*>[\s\S]*?class=["'][^"']*kal-libur-day[^"']*["'][^>]*>([^<]+)<\/div>\s*([^<]+)[\s\S]*?<\/li>/gi;
    let match: RegExpExecArray | null;
    while ((match = liRegex.exec(listMatch[1])) !== null) {
      const dayRaw = match[1].trim();
      const name = match[2].replace(/\s+/g, ' ').trim();
      if (!dayRaw || !name) continue;

      if (dayRaw.includes('-')) {
        const [startStr, endStr] = dayRaw.split('-', 2);
        const start = Number(startStr);
        const end = Number(endStr);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
        for (let d = start; d <= end; d++) {
          results.push({
            holidayDate: `${yearNum}-${month}-${String(d).padStart(2, '0')}`,
            name,
            year: yearNum,
          });
        }
      } else {
        const dayNum = Number(dayRaw);
        if (!Number.isFinite(dayNum)) continue;
        results.push({
          holidayDate: `${yearNum}-${month}-${String(dayNum).padStart(2, '0')}`,
          name,
          year: yearNum,
        });
      }
    }
  }

  return results;
}

/**
 * Fetches national holidays for a given year from tanggalans.com and caches them in PostgreSQL.
 */
export async function syncNationalHolidaysFromTanggalans(year: number) {
  const db = getDb();
  if (!db) throw new Error('Database not configured.');
  const res = await fetch(`https://tanggalans.com/kalender-${year}`, {
    headers: { 'User-Agent': 'SiteLens/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch tanggalans.com for ${year}: HTTP ${res.status}`);
  }
  const html = await res.text();
  const parsed = parseTanggalansHtml(html, year);

  for (const item of parsed) {
    await db
      .insert(nationalHolidays)
      .values({
        holidayDate: item.holidayDate,
        name: item.name,
        year: item.year,
        isNational: true,
        source: 'tanggalans.com',
      })
      .onConflictDoUpdate({
        target: nationalHolidays.holidayDate,
        set: { name: item.name, year: item.year, source: 'tanggalans.com' },
      });
  }

  return db.select().from(nationalHolidays).where(eq(nationalHolidays.year, year));
}
