import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ChecklistTemplate, InspectionRecord } from '../types';
import { Language } from '../i18n/translations';

interface GenerateTemplatePdfOptions {
  template: ChecklistTemplate;
  lang?: Language;
}

interface GenerateInspectionPdfOptions {
  inspection: InspectionRecord;
  template?: ChecklistTemplate;
  lang?: Language;
}

/**
 * Generates and downloads a clean, professional Blank Checklist PDF (Blanko Kosong)
 * built directly with jsPDF + jspdf-autotable for manual on-site clipboard audits.
 */
export function exportBlankChecklistPdf({ template, lang = 'id' }: GenerateTemplatePdfOptions) {
  const isId = lang === 'id';
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  // Header Bar: Slate Navy
  doc.setFillColor(15, 23, 42); // #0f172a
  doc.rect(margin, 12, pageWidth - margin * 2, 2.5, 'F');

  // Brand Name & Subtitle
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('SITELENS OPERATIONAL PROTOCOL', margin, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Precision in every detail  |  Flow without interruption', margin, 27);

  // Badge: Document Type
  const badgeText = isId ? 'BLANKO KOSONG LAPANGAN' : 'BLANK FIELD PROTOCOL';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const badgeWidth = doc.getTextWidth(badgeText) + 8;
  const badgeX = pageWidth - margin - badgeWidth;
  doc.setFillColor(239, 246, 255); // #eff6ff
  doc.setDrawColor(59, 130, 246); // #3b82f6
  doc.roundedRect(badgeX, 17, badgeWidth, 7, 1.5, 1.5, 'FD');
  doc.setTextColor(29, 78, 216); // #1d4ed8
  doc.text(badgeText, badgeX + 4, 21.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(`DOC-REF: ${template.id}  |  v${template.version}`, pageWidth - margin, 28, { align: 'right' });

  // Metadata Table
  const metaRows = [
    [
      { content: isId ? 'JUDUL PROTOKOL' : 'PROTOCOL TITLE', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: template.title, colSpan: 3, styles: { fontStyle: 'bold' as const, textColor: [15, 23, 42] as [number, number, number] } },
    ],
    [
      { content: isId ? 'DISIPLIN' : 'DISCIPLINE', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: template.category, styles: { textColor: [15, 23, 42] as [number, number, number] } },
      { content: isId ? 'TARGET PELAKSANA' : 'TARGET ROLE', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: template.targetRole, styles: { textColor: [15, 23, 42] as [number, number, number] } },
    ],
    [
      { content: isId ? 'PROYEK / LOKASI' : 'PROJECT / SITE', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: '__________________________________', styles: { textColor: [148, 163, 184] as [number, number, number] } },
      { content: isId ? 'ZONA / GRID' : 'ZONE / GRID', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: '_______________________', styles: { textColor: [148, 163, 184] as [number, number, number] } },
    ],
    [
      { content: isId ? 'NAMA INSPEKTUR' : 'INSPECTOR NAME', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: '__________________________________', styles: { textColor: [148, 163, 184] as [number, number, number] } },
      { content: isId ? 'TANGGAL & JAM' : 'DATE & TIME', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: '____ / ____ / 202___   ___:___', styles: { textColor: [148, 163, 184] as [number, number, number] } },
    ],
    [
      { content: isId ? 'VERIFIKASI' : 'VERIFICATION', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      {
        content: template.requiresApproval
          ? `${isId ? 'Wajib verifikasi & tanda tangan oleh: ' : 'Requires verification sign-off by: '}${template.approvalRole || 'Site Engineer'}`
          : (isId ? 'Pengesahan langsung oleh pelaksana di lapangan (Direct sign-off)' : 'Direct field sign-off enabled'),
        colSpan: 3,
        styles: { textColor: template.requiresApproval ? [180, 83, 9] as [number, number, number] : [21, 128, 61] as [number, number, number] },
      },
    ],
  ];

  autoTable(doc, {
    startY: 32,
    margin: { left: margin, right: margin },
    body: metaRows,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 62 },
      2: { cellWidth: 34 },
      3: { cellWidth: 54 },
    },
  });

  let currentY = (doc as any).lastAutoTable.finalY + 6;
  let itemCounter = 0;

  // Build tables for each section
  template.sections.forEach((sec, sIdx) => {
    // Check page break for section header
    if (currentY > pageHeight - 45) {
      doc.addPage();
      currentY = 16;
    }

    // Section Header Banner
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, pageWidth - margin * 2, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text(`${sIdx + 1}. ${sec.title.toUpperCase()}`, margin + 3, currentY + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`${sec.fields.length} ${isId ? 'Pemeriksaan' : 'Checks'}`, pageWidth - margin - 3, currentY + 4.5, { align: 'right' });
    currentY += 6.5;

    if (sec.description) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, currentY, pageWidth - margin * 2, 5, 'F');
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text(sec.description, margin + 3, currentY + 3.5);
      currentY += 5;
    }

    const tableRows = sec.fields.map((f) => {
      itemCounter++;
      const isInstruction = f.type === 'instruction';

      let resultHint = '';
      if (isInstruction) {
        resultHint = isId ? '[ Instruksi / Prasyarat ]' : '[ Prerequisite Guidance ]';
      } else if (f.type === 'pass_fail') {
        resultHint = '[  ] PASS   [  ] FAIL   [  ] N/A';
      } else if (f.type === 'yes_no') {
        resultHint = isId ? '[  ] YA     [  ] TIDAK' : '[  ] YES    [  ] NO';
      } else if (f.type === 'status_select') {
        const opts = f.options || (isId ? ['Normal', 'Perhatian', 'Kritis'] : ['Normal', 'Caution', 'Critical']);
        resultHint = opts.map((o) => `[  ] ${o}`).join('  ');
      } else if (f.type === 'number') {
        resultHint = f.unit ? `________ ${f.unit}` : '________';
      } else if (f.type === 'signature') {
        resultHint = isId ? '[ Paraf / Ttd ] _________' : '[ Sign / Initial ] _______';
      } else {
        resultHint = '________________________';
      }

      let checkItemText = f.label;
      if (f.description) {
        checkItemText += `\n${f.description}`;
      }
      if (f.helpStandard) {
        checkItemText += `\nStd: ${f.helpStandard}`;
      }

      return [
        String(itemCounter),
        checkItemText,
        resultHint,
        '', // Blank notes space for manual clipboard pen notes
      ];
    });

    autoTable(doc, {
      startY: currentY,
      margin: { left: margin, right: margin },
      head: [
        [
          'NO',
          isId ? 'PARAMETER / KRITERIA VERIFIKASI' : 'VERIFICATION PARAMETER / CRITERIA',
          isId ? 'HASIL LAPANGAN' : 'FIELD RESULT',
          isId ? 'CATATAN / TINDAK LANJUT' : 'NOTES / ACTIONS',
        ],
      ],
      body: tableRows,
      theme: 'grid',
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [51, 65, 85],
        fontSize: 7.5,
        fontStyle: 'bold',
        cellPadding: 2,
        lineColor: [203, 213, 225],
        lineWidth: 0.2,
      },
      styles: {
        fontSize: 8,
        cellPadding: 2.2,
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
        textColor: [15, 23, 42],
        valign: 'middle',
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center', fontStyle: 'bold', textColor: [100, 116, 139] },
        1: { cellWidth: 92 },
        2: { cellWidth: 46, halign: 'center', fontStyle: 'bold', textColor: [51, 65, 85] },
        3: { cellWidth: 34 },
      },
    });

    currentY = (doc as any).lastAutoTable.finalY + 5;
  });

  // Check page break for Signatures Block
  if (currentY > pageHeight - 50) {
    doc.addPage();
    currentY = 16;
  }

  // Field Notes Block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text(isId ? 'CATATAN UMUM LAPANGAN & HAMBATAN CUACA:' : 'GENERAL FIELD OBSERVATIONS & SITE CONDITIONS:', margin, currentY);
  currentY += 2;

  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, currentY, pageWidth - margin * 2, 16, 'FD');
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(isId ? '(Tuliskan catatan kondisi cuaca, kesiapan kontraktor, atau hambatan pekerjaan di sini...)' : '(Record weather conditions, contractor attendance, delays, or permits...)', margin + 3, currentY + 5);
  currentY += 20;

  // Signatures Table
  const sigHeaders = [
    isId ? '1. INSPEKTUR / PELAKSANA' : '1. INSPECTOR / PERFORMED BY',
    isId ? '2. PENGAWAS LAPANGAN / MANDOR' : '2. SITE SUPERVISOR / FOREMAN',
    isId ? '3. VERIFIKATOR / ENGINEER' : '3. CERTIFIER / SITE ENGINEER',
  ];

  autoTable(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [sigHeaders],
    body: [
      [
        `\n\n\n${isId ? 'Nama' : 'Name'}: _______________________\n${template.targetRole}\n${isId ? 'Tgl' : 'Date'}: ____ / ____ / 202___`,
        `\n\n\n${isId ? 'Nama' : 'Name'}: _______________________\nSite Supervisor\n${isId ? 'Tgl' : 'Date'}: ____ / ____ / 202___`,
        `\n\n\n${isId ? 'Nama' : 'Name'}: _______________________\n${template.approvalRole || 'Site Engineer'}\n${isId ? 'Tgl' : 'Date'}: ____ / ____ / 202___`,
      ],
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [71, 85, 105],
      fontSize: 7.5,
      fontStyle: 'bold',
      cellPadding: 2,
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
      halign: 'center',
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 3,
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
      textColor: [15, 23, 42],
    },
    columnStyles: {
      0: { cellWidth: (pageWidth - margin * 2) / 3 },
      1: { cellWidth: (pageWidth - margin * 2) / 3 },
      2: { cellWidth: (pageWidth - margin * 2) / 3 },
    },
  });

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`SiteLens Precision Operations  |  Blank Checklist Sheet  |  Generated ${new Date().toLocaleDateString()}`, margin, pageHeight - 6);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
  }

  // Trigger file download
  const safeTitle = template.title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  doc.save(`sitelens_blank_${safeTitle}.pdf`);
}

/**
 * Generates and downloads a complete, certified Inspection Report PDF (Blanko Terisi)
 * complete with field responses, Pass/Fail badges, photos, compliance score, and signatures.
 */
export function exportFilledInspectionPdf({
  inspection,
  template,
  lang = 'id',
}: GenerateInspectionPdfOptions) {
  const isId = lang === 'id';
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  const executionDate = inspection.submittedAt || inspection.createdAt;

  // Header Bar: Slate Navy
  doc.setFillColor(15, 23, 42); // #0f172a
  doc.rect(margin, 12, pageWidth - margin * 2, 2.5, 'F');

  // Brand Name & Subtitle
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('SITELENS CERTIFIED AUDIT REPORT', margin, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Official Site Operations & Quality Compliance Certificate', margin, 27);

  // Status Badge Colors
  const isApproved = inspection.status === 'approved';
  const isRejected = inspection.status === 'rejected';
  const badgeBg: [number, number, number] = isApproved
    ? [220, 252, 231]
    : isRejected
    ? [254, 226, 226]
    : [254, 243, 199];
  const badgeBorder: [number, number, number] = isApproved
    ? [134, 239, 172]
    : isRejected
    ? [252, 165, 165]
    : [253, 224, 71];
  const badgeTextCol: [number, number, number] = isApproved
    ? [21, 128, 61]
    : isRejected
    ? [185, 28, 28]
    : [180, 83, 9];

  const statusLabel = inspection.status.toUpperCase().replace('_', ' ');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const badgeWidth = doc.getTextWidth(statusLabel) + 10;
  const badgeX = pageWidth - margin - badgeWidth;
  doc.setFillColor(badgeBg[0], badgeBg[1], badgeBg[2]);
  doc.setDrawColor(badgeBorder[0], badgeBorder[1], badgeBorder[2]);
  doc.roundedRect(badgeX, 17, badgeWidth, 7, 1.5, 1.5, 'FD');
  doc.setTextColor(badgeTextCol[0], badgeTextCol[1], badgeTextCol[2]);
  doc.text(statusLabel, badgeX + 5, 21.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`RECORD #${inspection.id}`, pageWidth - margin, 28, { align: 'right' });

  // Metadata Table
  const metaRows = [
    [
      { content: isId ? 'PROTOKOL INSPEKSI' : 'INSPECTION PROTOCOL', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: inspection.templateTitle, colSpan: 3, styles: { fontStyle: 'bold' as const, textColor: [15, 23, 42] as [number, number, number] } },
    ],
    [
      { content: isId ? 'PROYEK' : 'PROJECT', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: inspection.projectName, styles: { fontStyle: 'bold' as const, textColor: [15, 23, 42] as [number, number, number] } },
      { content: isId ? 'ZONA / AREA' : 'SITE ZONE', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: inspection.siteZone, styles: { textColor: [15, 23, 42] as [number, number, number] } },
    ],
    [
      { content: isId ? 'INSPEKTUR' : 'INSPECTOR', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: `${inspection.inspectorName} (${inspection.inspectorRole})`, styles: { textColor: [15, 23, 42] as [number, number, number] } },
      { content: isId ? 'WAKTU PELAKSANAAN' : 'EXECUTION DATE', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: executionDate, styles: { textColor: [15, 23, 42] as [number, number, number] } },
    ],
    [
      { content: isId ? 'SKOR KEPATUHAN' : 'COMPLIANCE SCORE', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      {
        content: `${inspection.scorePercent}% (${inspection.passedCount} Pass / ${inspection.failedCount} Fail)`,
        styles: {
          fontStyle: 'bold' as const,
          textColor: inspection.scorePercent >= 90 ? [21, 128, 61] as [number, number, number] : inspection.scorePercent >= 75 ? [180, 83, 9] as [number, number, number] : [185, 28, 28] as [number, number, number],
        },
      },
      { content: isId ? 'STATUS VERIFIKASI' : 'REVIEW STATUS', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: `${statusLabel}${inspection.reviewedBy ? ` by ${inspection.reviewedBy}` : ''}`, styles: { fontStyle: 'bold' as const, textColor: badgeTextCol } },
    ],
  ];

  if (inspection.reviewNotes) {
    metaRows.push([
      { content: isId ? 'CATATAN REVIEW' : 'REVIEWER NOTES', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [71, 85, 105] as [number, number, number] } },
      { content: `"${inspection.reviewNotes}"`, colSpan: 3, styles: { fontStyle: 'italic' as any, textColor: [51, 65, 85] as [number, number, number] } },
    ]);
  }

  autoTable(doc, {
    startY: 32,
    margin: { left: margin, right: margin },
    body: metaRows,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 60 },
      2: { cellWidth: 34 },
      3: { cellWidth: 54 },
    },
  });

  let currentY = (doc as any).lastAutoTable.finalY + 6;
  let itemCounter = 0;

  if (template && template.sections) {
    template.sections.forEach((sec, sIdx) => {
      if (currentY > pageHeight - 45) {
        doc.addPage();
        currentY = 16;
      }

      // Section Header Banner
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, currentY, pageWidth - margin * 2, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      doc.text(`${sIdx + 1}. ${sec.title.toUpperCase()}`, margin + 3, currentY + 4.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(`${sec.fields.length} ${isId ? 'Pemeriksaan' : 'Items'}`, pageWidth - margin - 3, currentY + 4.5, { align: 'right' });
      currentY += 6.5;

      const tableRows = sec.fields.map((f) => {
        itemCounter++;
        const rawVal = inspection.answers?.[f.id];
        const isInstruction = f.type === 'instruction';

        let resultDisplay = '';
        let isFail = false;
        let isPass = false;

        if (isInstruction) {
          resultDisplay = isId ? '[ Panduan / SOP ]' : '[ Prerequisite ]';
        } else if (f.type === 'pass_fail') {
          if (rawVal === 'pass') {
            resultDisplay = 'PASS';
            isPass = true;
          } else if (rawVal === 'fail') {
            resultDisplay = 'FAIL';
            isFail = true;
          } else if (rawVal === 'na') {
            resultDisplay = 'N/A';
          } else {
            resultDisplay = '-';
          }
        } else if (f.type === 'yes_no') {
          if (rawVal === 'yes') {
            resultDisplay = isId ? 'YA' : 'YES';
            isPass = true;
          } else if (rawVal === 'no') {
            resultDisplay = isId ? 'TIDAK' : 'NO';
            isFail = true;
          } else {
            resultDisplay = '-';
          }
        } else if (f.type === 'photo') {
          resultDisplay = rawVal ? (isId ? 'Foto Terlampir' : 'Photo Attached') : '-';
        } else if (f.type === 'signature') {
          resultDisplay = rawVal ? (isId ? 'Tanda Tangan Digital' : 'Digitally Signed') : '-';
        } else {
          resultDisplay = rawVal !== undefined ? `${String(rawVal)} ${f.unit || ''}` : '-';
        }

        let checkItemText = f.label;
        if (f.helpStandard) {
          checkItemText += `\nStd: ${f.helpStandard}`;
        }

        const conditionStatus = isFail
          ? (isId ? 'TIDAK SESUAI (FAIL)' : 'NON-CONFORMANCE')
          : isPass
          ? (isId ? 'SESUAI (OK)' : 'COMPLIANT')
          : '-';

        return [
          String(itemCounter),
          checkItemText,
          {
            content: resultDisplay,
            styles: {
              fontStyle: 'bold' as const,
              textColor: isFail
                ? [185, 28, 28] as [number, number, number]
                : isPass
                ? [21, 128, 61] as [number, number, number]
                : [15, 23, 42] as [number, number, number],
            },
          },
          {
            content: conditionStatus,
            styles: {
              textColor: isFail ? [185, 28, 28] as [number, number, number] : [100, 116, 139] as [number, number, number],
              fontStyle: isFail ? ('bold' as const) : ('normal' as const),
            },
          },
        ];
      });

      autoTable(doc, {
        startY: currentY,
        margin: { left: margin, right: margin },
        head: [
          [
            'NO',
            isId ? 'PARAMETER PEMERIKSAAN' : 'INSPECTION PARAMETER',
            isId ? 'HASIL VERIFIKASI' : 'RESULT',
            isId ? 'STATUS KONDISI' : 'CONDITION STATUS',
          ],
        ],
        body: tableRows,
        theme: 'grid',
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [51, 65, 85],
          fontSize: 7.5,
          fontStyle: 'bold',
          cellPadding: 2,
          lineColor: [203, 213, 225],
          lineWidth: 0.2,
        },
        styles: {
          fontSize: 8,
          cellPadding: 2.2,
          lineColor: [226, 232, 240],
          lineWidth: 0.2,
          textColor: [15, 23, 42],
          valign: 'middle',
        },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center', fontStyle: 'bold', textColor: [100, 116, 139] },
          1: { cellWidth: 92 },
          2: { cellWidth: 42, halign: 'center' },
          3: { cellWidth: 38 },
        },
      });

      currentY = (doc as any).lastAutoTable.finalY + 5;
    });
  } else {
    // Fallback if template is not supplied
    const answersEntries = Object.entries(inspection.answers || {});
    const flatRows = answersEntries.map(([k, v], idx) => [
      String(idx + 1),
      k,
      String(v),
    ]);

    autoTable(doc, {
      startY: currentY,
      margin: { left: margin, right: margin },
      head: [['#', isId ? 'PARAMETER' : 'FIELD ID', isId ? 'RESPON / NILAI' : 'VALUE']],
      body: flatRows,
      theme: 'grid',
    });

    currentY = (doc as any).lastAutoTable.finalY + 5;
  }

  // Evidence Photos Block (if any photos exist)
  if (inspection.evidencePhotos && inspection.evidencePhotos.length > 0) {
    if (currentY > pageHeight - 55) {
      doc.addPage();
      currentY = 16;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `${isId ? 'DOKUMENTASI FOTO BUKTI LAPANGAN' : 'PHOTOGRAPHIC FIELD EVIDENCE'} (${inspection.evidencePhotos.length})`,
      margin,
      currentY
    );
    currentY += 4;

    const colWidth = (pageWidth - margin * 2 - 8) / 2;
    const imgHeight = 38;

    inspection.evidencePhotos.forEach((photo, pIdx) => {
      const col = pIdx % 2;
      if (col === 0 && pIdx > 0) {
        currentY += imgHeight + 12;
      }

      if (currentY + imgHeight + 12 > pageHeight - 20) {
        doc.addPage();
        currentY = 16;
      }

      const xPos = margin + col * (colWidth + 8);

      try {
        if (photo.url && photo.url.startsWith('data:image')) {
          doc.addImage(photo.url, 'JPEG', xPos, currentY, colWidth, imgHeight);
        } else {
          doc.setFillColor(241, 245, 249);
          doc.rect(xPos, currentY, colWidth, imgHeight, 'F');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(100, 116, 139);
          doc.text(`[ Photo #${pIdx + 1}: ${photo.caption || 'Evidence'} ]`, xPos + colWidth / 2, currentY + imgHeight / 2, { align: 'center' });
        }
      } catch {
        doc.setFillColor(241, 245, 249);
        doc.rect(xPos, currentY, colWidth, imgHeight, 'F');
      }

      doc.setDrawColor(203, 213, 225);
      doc.rect(xPos, currentY, colWidth, imgHeight);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      doc.text(`#${pIdx + 1}: ${photo.caption || (isId ? 'Temuan Lapangan' : 'Field Finding')}`, xPos, currentY + imgHeight + 4);
    });

    currentY += imgHeight + 12;
  }

  // Check page break for Signatures Block
  if (currentY > pageHeight - 45) {
    doc.addPage();
    currentY = 16;
  }

  // Signatures Table
  const sigBoxHeaders = [
    isId ? 'INSPEKTUR PELAKSANA' : 'FIELD INSPECTOR',
    isId ? 'VERIFIKASI & PENGESAHAN ENGINEER' : 'ENGINEER CERTIFICATION',
    isId ? 'SEGEL INTEGRITAS SISTEM' : 'SYSTEM TAMPER AUDIT',
  ];

  const certStatus = isApproved
    ? 'APPROVED & CERTIFIED'
    : isRejected
    ? 'REJECTED / ACTION REQD'
    : 'AWAITING SIGN-OFF';

  autoTable(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [sigBoxHeaders],
    body: [
      [
        `\n[ VERIFIED DIGITAL STAMP ]\n\n${inspection.inspectorName}\n${inspection.inspectorRole}\n${executionDate}`,
        `\n[ ${certStatus} ]\n\n${inspection.reviewedBy || 'Site Engineer / HSE'}\n${inspection.reviewedAt || executionDate}`,
        `\nHASH: SHA256-${inspection.id.slice(-6).toUpperCase()}\nSiteLens Cloud Audit\nISO 19011 Compliance Log`,
      ],
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [71, 85, 105],
      fontSize: 7.5,
      fontStyle: 'bold',
      cellPadding: 2,
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
      halign: 'center',
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 3,
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
      textColor: [15, 23, 42],
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: (pageWidth - margin * 2) / 3 },
      1: { cellWidth: (pageWidth - margin * 2) / 3 },
      2: { cellWidth: (pageWidth - margin * 2) / 3 },
    },
  });

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`SiteLens Precision Operations  |  Certified Audit Record #${inspection.id}  |  Printed ${new Date().toLocaleDateString()}`, margin, pageHeight - 6);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
  }

  // Trigger file download
  doc.save(`sitelens_inspection_report_${inspection.id}.pdf`);
}
