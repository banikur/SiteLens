import { createWorker } from 'tesseract.js';
import { ChecklistTemplate, ChecklistSection, ChecklistField, FieldType, ChecklistCategory } from '../types';

export interface OcrProgressCallback {
  status: string;
  progress: number;
}

/**
 * Pre-processes an image on an in-memory HTML canvas for optimal Tesseract OCR accuracy.
 * Converts to grayscale, enhances contrast, and scales down excessive mobile megapixels.
 */
export async function preprocessImageForOcr(imageDataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(imageDataUrl);
          return;
        }

        // Target width: 1400px - 1800px is optimal for Tesseract character recognition
        const maxDim = 1600;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // Grayscale & contrast enhancement
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        const contrast = 1.25; // 25% contrast boost
        const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Grayscale (ITU-R BT.601)
          let gray = 0.299 * r + 0.587 * g + 0.114 * b;
          // Apply contrast
          gray = factor * (gray - 128) + 128;
          gray = Math.max(0, Math.min(255, gray));

          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch {
        resolve(imageDataUrl);
      }
    };
    img.onerror = (e) => reject(e);
    img.src = imageDataUrl;
  });
}

/**
 * Runs client-side Tesseract.js OCR directly in browser web worker.
 * Supports bilingual recognition (Indonesian 'ind' + English 'eng').
 */
export async function recognizeTextFromImage(
  imageSource: string | File | Blob,
  onProgress?: (info: OcrProgressCallback) => void
): Promise<{ text: string; confidence: number; lines: string[] }> {
  const worker = await createWorker(['eng', 'ind'], undefined, {
    logger: (m) => {
      if (onProgress && m.status) {
        onProgress({
          status: m.status,
          progress: typeof m.progress === 'number' ? Math.round(m.progress * 100) : 0,
        });
      }
    },
  });

  try {
    const ret = await worker.recognize(imageSource);
    await worker.terminate();

    const rawText = ret.data.text || '';
    const cleanLines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    return {
      text: rawText,
      confidence: ret.data.confidence,
      lines: cleanLines,
    };
  } catch (err) {
    await worker.terminate();
    throw err;
  }
}

/**
 * FEATURE 1: CLONE TEMPLATE FROM OCR
 * Parses raw scanned paper form / checklist text into a structured SiteLens ChecklistTemplate.
 * Extracts section headers, itemized checkboxes, numbers, units, and safety prerequisites.
 */
export function parseOcrIntoTemplate(
  ocrText: string,
  options: {
    category?: ChecklistCategory;
    authorName?: string;
    lang?: 'en' | 'id';
  } = {}
): ChecklistTemplate {
  const isId = options.lang === 'id';
  const category = options.category || 'Safety & HSE';
  const authorName = options.authorName || 'Field Inspector';
  const timestamp = Date.now();
  const today = new Date().toISOString().split('T')[0];

  const rawLines = ocrText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Infer Title from first prominent line
  let title = isId ? 'Template Hasil Pindai Kertas' : 'Cloned Paper Inspection Protocol';
  for (const line of rawLines.slice(0, 5)) {
    const clean = line.replace(/^[0-9\W]+/, '').trim();
    if (clean.length > 5 && !clean.toLowerCase().includes('sitelens') && !clean.toLowerCase().includes('page')) {
      title = clean;
      break;
    }
  }

  const sections: ChecklistSection[] = [];
  let currentSection: ChecklistSection = {
    id: `sec-ocr-${timestamp}-1`,
    title: isId ? 'Bagian 1: Verifikasi Umum Lapangan' : 'Section 1: General Site Verification',
    description: isId ? 'Item dipindai dari lembar form fisik' : 'Checkpoints scanned from physical form',
    fields: [],
  };

  const isSectionHeader = (line: string): boolean => {
    const lower = line.toLowerCase();
    return (
      /^section\s+[0-9ivx]/i.test(line) ||
      /^bagian\s+[0-9ivx]/i.test(line) ||
      /^(tahap|area|zona|modul)\s+[0-9]/i.test(line) ||
      (line === line.toUpperCase() && line.length > 8 && line.length < 50 && !line.includes(':') && !line.includes('___')) ||
      (lower.includes('preparation') || lower.includes('persiapan') || lower.includes('safety') || lower.includes('keselamatan') || lower.includes('structural') || lower.includes('struktur'))
    );
  };

  const isMetadataLine = (line: string): boolean => {
    const lower = line.toLowerCase();
    return (
      lower.includes('project:') ||
      lower.includes('proyek:') ||
      lower.includes('inspector:') ||
      lower.includes('inspektur:') ||
      lower.includes('date:') ||
      lower.includes('tanggal:') ||
      lower.includes('zone:') ||
      lower.includes('grid:') ||
      lower.includes('doc-ref:') ||
      lower.includes('page ') ||
      lower.includes('halaman ') ||
      lower.includes('iso 9001') ||
      lower.includes('precision in every detail') ||
      lower.includes('sitelens')
    );
  };

  let fieldCounter = 0;

  for (const rawLine of rawLines) {
    if (isMetadataLine(rawLine)) continue;

    // Check if new section
    if (isSectionHeader(rawLine) && currentSection.fields.length >= 2) {
      sections.push(currentSection);
      currentSection = {
        id: `sec-ocr-${timestamp}-${sections.length + 1}`,
        title: rawLine.replace(/^[#\-*_\s]+/, '').trim(),
        description: '',
        fields: [],
      };
      continue;
    }

    // Filter out signature blocks
    if (
      rawLine.toLowerCase().includes('tanda tangan') ||
      rawLine.toLowerCase().includes('signature') ||
      rawLine.toLowerCase().includes('paraf') ||
      rawLine.toLowerCase().includes('catatan umum') ||
      rawLine.toLowerCase().includes('weather condition')
    ) {
      continue;
    }

    // Clean leading numbers or bullets: "1. ", "1) ", "[ ] ", "(a) "
    const cleanLabel = rawLine
      .replace(/^(\d+[\.\)\-:]|\([a-z\d]+\)|\[[\s\dxXvV\u2713\u2714]*\]|[-*•])\s*/i, '')
      .replace(/\[\s*\]/g, '')
      .replace(/_{3,}/g, '')
      .trim();

    if (cleanLabel.length < 3) continue;

    fieldCounter++;
    const lower = cleanLabel.toLowerCase();

    // Infer Field Type & Units
    let type: FieldType = 'pass_fail';
    let unit: string | undefined = undefined;

    if (lower.includes('instruksi') || lower.includes('prerequisite') || lower.startsWith('perhatian:') || lower.startsWith('warning:')) {
      type = 'instruction';
    } else if (lower.includes('tekanan') || lower.includes('pressure') || lower.includes('psi') || lower.includes('bar')) {
      type = 'number';
      unit = lower.includes('psi') ? 'psi' : 'bar';
    } else if (lower.includes('suhu') || lower.includes('temperature') || lower.includes('°c') || lower.includes('deg c')) {
      type = 'number';
      unit = '°C';
    } else if (lower.includes('ketebalan') || lower.includes('thickness') || lower.includes('panjang') || lower.includes('dimensi') || lower.includes('mm') || lower.includes('slump')) {
      type = 'number';
      unit = 'mm';
    } else if (lower.includes('kecepatan') || lower.includes('speed') || lower.includes('km/h') || lower.includes('knots')) {
      type = 'number';
      unit = 'km/h';
    } else if (lower.includes('persen') || lower.includes('percentage') || lower.includes('%')) {
      type = 'number';
      unit = '%';
    } else if (lower.includes('apakah') || lower.includes('is there') || lower.includes('ada / tidak') || lower.includes('ya / tidak')) {
      type = 'yes_no';
    } else if (lower.includes('status') || lower.includes('kondisi') || lower.includes('condition')) {
      type = 'status_select';
    } else if (lower.includes('foto') || lower.includes('photo') || lower.includes('dokumentasi')) {
      type = 'photo';
    } else if (lower.includes('nomor seri') || lower.includes('serial number') || lower.includes('tag id') || lower.includes('plat nomor')) {
      type = 'short_text';
    } else if (lower.includes('catatan') || lower.includes('remarks') || lower.includes('keterangan')) {
      type = 'long_text';
    }

    const field: ChecklistField = {
      id: `fld-ocr-${timestamp}-${sections.length + 1}-${fieldCounter}`,
      type,
      label: cleanLabel,
      required: type !== 'instruction',
      unit,
      options: type === 'status_select' ? (isId ? ['Normal', 'Perhatian', 'Kritis'] : ['Normal', 'Caution', 'Critical']) : undefined,
    };

    currentSection.fields.push(field);
  }

  if (currentSection.fields.length > 0) {
    sections.push(currentSection);
  }

  // Fallback default section if none caught
  if (sections.length === 0) {
    sections.push({
      id: `sec-ocr-${timestamp}-1`,
      title: isId ? 'Bagian 1: Verifikasi Lapangan' : 'Section 1: Field Verifications',
      description: isId ? 'Checklist hasil OCR' : 'OCR Checklist Items',
      fields: [
        {
          id: `fld-ocr-${timestamp}-1-1`,
          type: 'pass_fail',
          label: isId ? 'Pemeriksaan Kelayakan Fisik & Keamanan' : 'Physical Integrity & Safety Check',
          required: true,
        },
      ],
    });
  }

  return {
    id: `tmpl-ocr-${timestamp}`,
    title: title.slice(0, 60),
    category,
    description: isId
      ? `Protokol hasil kloning dokumen fisik via OCR. Berisi ${fieldCounter} poin verifikasi.`
      : `Cloned from physical paper form via local OCR. Contains ${fieldCounter} checkpoints.`,
    version: '1.0',
    targetRole: 'Field Inspector / Petugas K3',
    requiresApproval: true,
    approvalRole: 'Authorized Inspector (API 510/570) & Verifikator K3',
    estimatedMinutes: Math.min(60, Math.max(15, Math.round(fieldCounter * 2.5))),
    tags: ['OCR Cloned', 'Paper Form', 'SiteLens Vision'],
    createdAt: today,
    updatedAt: today,
    authorName,
    authorRole: 'Office / Integrity Engineer',
    sections,
  };
}

/**
 * FEATURE 2: AUTO-FILL FIELD INSPECTION FROM SCANNED BLANKO
 * Matches OCR-recognized text against an existing ChecklistTemplate's fields.
 * Extracts checked boxes [X] PASS/FAIL, hand-written measurements, and notes.
 */
export interface OcrFillResult {
  detectedAnswers: Record<string, any>;
  matchedCount: number;
  totalFieldsCount: number;
  confidenceScore: number;
  unmatchedNotes: string[];
  recognizedTextSnippet: string;
}

export function matchOcrTextToTemplateForm(
  ocrText: string,
  template: ChecklistTemplate
): OcrFillResult {
  const detectedAnswers: Record<string, any> = {};
  const unmatchedNotes: string[] = [];
  const lines = ocrText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  let totalFieldsCount = 0;
  const allFields: ChecklistField[] = [];
  template.sections.forEach((sec) => {
    sec.fields.forEach((f) => {
      if (f.type !== 'instruction') {
        allFields.push(f);
        totalFieldsCount++;
      }
    });
  });

  // Normalize helper
  const cleanWordTokens = (str: string): string[] =>
    str
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

  // Line-by-line inspection parsing
  allFields.forEach((field, fIdx) => {
    const fieldTokens = cleanWordTokens(field.label);
    const itemNumPrefix = `${fIdx + 1}`;

    // Find the best line corresponding to this field
    let matchedLine: string | null = null;
    let highestScore = 0;

    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      // Direct number match: "1. ", "1) "
      const startsWithNum =
        lowerLine.startsWith(`${itemNumPrefix}.`) ||
        lowerLine.startsWith(`${itemNumPrefix})`) ||
        lowerLine.startsWith(`${itemNumPrefix} `);

      let tokenMatches = 0;
      for (const token of fieldTokens) {
        if (lowerLine.includes(token)) tokenMatches++;
      }

      const matchRatio = fieldTokens.length > 0 ? tokenMatches / fieldTokens.length : 0;
      const combinedScore = (startsWithNum ? 0.6 : 0) + matchRatio * 0.4;

      if (combinedScore > highestScore && combinedScore > 0.35) {
        highestScore = combinedScore;
        matchedLine = line;
      }
    }

    if (!matchedLine) return;

    const lower = matchedLine.toLowerCase();

    // Check pass/fail logic
    if (field.type === 'pass_fail') {
      // Look for [X] PASS, [v] PASS, (X) PASS, or FAIL markers
      const hasFailMark =
        /\[[xXvV\u2713\u2714\*\+]\]\s*fail/i.test(matchedLine) ||
        /\bfail\b.*[xXvV\u2713\u2714]/i.test(matchedLine) ||
        lower.includes('tidak lulus') ||
        lower.includes('gagal');

      const hasPassMark =
        /\[[xXvV\u2713\u2714\*\+]\]\s*pass/i.test(matchedLine) ||
        /\bpass\b.*[xXvV\u2713\u2714]/i.test(matchedLine) ||
        lower.includes(' lulus') ||
        lower.includes('ok');

      const hasNaMark = /\[[xXvV\u2713\u2714\*\+]\]\s*n\/?a/i.test(matchedLine) || lower.includes('n/a');

      if (hasFailMark) {
        detectedAnswers[field.id] = 'fail';
      } else if (hasPassMark) {
        detectedAnswers[field.id] = 'pass';
      } else if (hasNaMark) {
        detectedAnswers[field.id] = 'na';
      } else {
        // Fallback: if line contains PASS but not FAIL, or checkmark detected
        if (lower.includes('pass') && !lower.includes('fail')) {
          detectedAnswers[field.id] = 'pass';
        } else if (lower.includes('fail')) {
          detectedAnswers[field.id] = 'fail';
        }
      }
    } else if (field.type === 'yes_no') {
      const hasNo = /\[[xXvV\u2713\u2714\*\+]\]\s*(no|tidak)/i.test(matchedLine) || lower.includes('tidak');
      const hasYes = /\[[xXvV\u2713\u2714\*\+]\]\s*(yes|ya)/i.test(matchedLine) || lower.includes(' ya');

      if (hasNo) {
        detectedAnswers[field.id] = 'no';
      } else if (hasYes) {
        detectedAnswers[field.id] = 'yes';
      }
    } else if (field.type === 'number') {
      // Extract numeric value from line (e.g. "120 psi", "35.5 mm", "40")
      const numMatch = matchedLine.match(/(\d+(?:[.,]\d+)?)\s*(?:mm|psi|bar|°c|c|%|kn|km\/h)?/i);
      if (numMatch && numMatch[1]) {
        detectedAnswers[field.id] = parseFloat(numMatch[1].replace(',', '.'));
      }
    } else if (field.type === 'status_select') {
      if (field.options) {
        for (const opt of field.options) {
          if (lower.includes(opt.toLowerCase())) {
            detectedAnswers[field.id] = opt;
            break;
          }
        }
      }
    } else if (field.type === 'short_text' || field.type === 'long_text') {
      // Extract remainder of line after ':' or after checkbox
      const parts = matchedLine.split(/[:\-\—]/);
      if (parts.length > 1) {
        const candidate = parts[parts.length - 1].trim();
        if (candidate.length > 2 && !candidate.includes('___')) {
          detectedAnswers[field.id] = candidate;
        }
      }
    }
  });

  // Extract general handwritten remarks/notes block if present
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (
      l.toLowerCase().includes('catatan umum') ||
      l.toLowerCase().includes('general notes') ||
      l.toLowerCase().includes('weather') ||
      l.toLowerCase().includes('rekomendasi')
    ) {
      const notesLines = lines.slice(i + 1, i + 4).filter((nl) => !nl.includes('___') && nl.length > 5);
      if (notesLines.length > 0) {
        unmatchedNotes.push(...notesLines);
      }
    }
  }

  const matchedCount = Object.keys(detectedAnswers).length;
  const confidenceScore = totalFieldsCount > 0 ? Math.round((matchedCount / totalFieldsCount) * 100) : 0;

  return {
    detectedAnswers,
    matchedCount,
    totalFieldsCount,
    confidenceScore,
    unmatchedNotes,
    recognizedTextSnippet: lines.slice(0, 15).join('\n'),
  };
}
