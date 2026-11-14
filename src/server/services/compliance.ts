import type {
  Smk3AuditLevel,
  Smk3AwardStatus,
  ChemicalHazardStatus,
  ChemicalInventoryItem,
  Smk3ElementMapping,
  CorrectiveAction,
} from '../../types/index.ts';

// Standard NAK Chemical Reference Values (Kepmenaker No. 187/MEN/1999 Lampiran III)
export const STANDARD_NAK_REFERENCE = [
  { name: 'Chlorine (Cl2)', casNumber: '7782-50-5', category: 'Toxic' as const, thresholdNakKg: 10_000 },
  { name: 'Ammonia (NH3)', casNumber: '7664-41-7', category: 'Toxic' as const, thresholdNakKg: 100_000 },
  { name: 'Hydrogen Sulfide (H2S)', casNumber: '7783-06-4', category: 'Toxic' as const, thresholdNakKg: 5_000 },
  { name: 'Sulfur Dioxide (SO2)', casNumber: '7446-09-5', category: 'Toxic' as const, thresholdNakKg: 20_000 },
  { name: 'LPG / Propane / Butane', casNumber: '68476-85-7', category: 'Flammable' as const, thresholdNakKg: 50_000 },
  { name: 'Hydrogen (H2)', casNumber: '1333-74-0', category: 'Flammable' as const, thresholdNakKg: 5_000 },
  { name: 'Acetylene (C2H2)', casNumber: '74-86-2', category: 'Flammable' as const, thresholdNakKg: 5_000 },
  { name: 'Diesel / Fuel Oil', casNumber: '68334-30-5', category: 'Flammable' as const, thresholdNakKg: 200_000 },
  { name: 'Gasoline (Premium/Pertamax)', casNumber: '86290-81-5', category: 'Flammable' as const, thresholdNakKg: 100_000 },
  { name: 'Sulfuric Acid (H2SO4)', casNumber: '7664-93-9', category: 'Corrosive' as const, thresholdNakKg: 100_000 },
  { name: 'Hydrochloric Acid (HCl)', casNumber: '7647-01-0', category: 'Corrosive' as const, thresholdNakKg: 50_000 },
  { name: 'Sodium Hydroxide (NaOH)', casNumber: '1310-73-2', category: 'Corrosive' as const, thresholdNakKg: 100_000 },
  { name: 'Ammonium Nitrate', casNumber: '6484-52-2', category: 'Oxidizing' as const, thresholdNakKg: 50_000 },
  { name: 'Benzene', casNumber: '71-43-2', category: 'Flammable' as const, thresholdNakKg: 50_000 },
];

// 12 Elemen Audit SMK3 PP No. 50/2012 & Pemetaan ISO 45001:2018
export const DEFAULT_SMK3_ELEMENTS: Smk3ElementMapping[] = [
  {
    elementNumber: 1,
    elementName: 'Pembangunan & Pemeliharaan Komitmen',
    iso45001Clause: 'Klausul 5',
    iso45001Title: 'Leadership and Worker Participation',
    totalCriteriaAwal: 6,
    totalCriteriaTransisi: 8,
    totalCriteriaLanjutan: 12,
    criteriaActive: 12,
    passedCriteria: 11,
    failedCriteria: 1,
    complianceRate: 92,
  },
  {
    elementNumber: 2,
    elementName: 'Pembuatan & Pendokumentasian Rencana K3',
    iso45001Clause: 'Klausul 6',
    iso45001Title: 'Planning',
    totalCriteriaAwal: 4,
    totalCriteriaTransisi: 8,
    totalCriteriaLanjutan: 14,
    criteriaActive: 14,
    passedCriteria: 13,
    failedCriteria: 1,
    complianceRate: 93,
  },
  {
    elementNumber: 3,
    elementName: 'Pengendalian Perancangan & Peninjauan Kontrak',
    iso45001Clause: 'Klausul 8.1.4',
    iso45001Title: 'Procurement & Contractor Controls',
    totalCriteriaAwal: 3,
    totalCriteriaTransisi: 6,
    totalCriteriaLanjutan: 8,
    criteriaActive: 8,
    passedCriteria: 7,
    failedCriteria: 1,
    complianceRate: 88,
  },
  {
    elementNumber: 4,
    elementName: 'Pengendalian Dokumen',
    iso45001Clause: 'Klausul 7.5',
    iso45001Title: 'Documented Information',
    totalCriteriaAwal: 3,
    totalCriteriaTransisi: 4,
    totalCriteriaLanjutan: 6,
    criteriaActive: 6,
    passedCriteria: 6,
    failedCriteria: 0,
    complianceRate: 100,
  },
  {
    elementNumber: 5,
    elementName: 'Pembelian & Pengendalian Produk',
    iso45001Clause: 'Klausul 8.1.4',
    iso45001Title: 'Procurement Safety Controls',
    totalCriteriaAwal: 2,
    totalCriteriaTransisi: 4,
    totalCriteriaLanjutan: 6,
    criteriaActive: 6,
    passedCriteria: 5,
    failedCriteria: 1,
    complianceRate: 83,
  },
  {
    elementNumber: 6,
    elementName: 'Keamanan Bekerja berdasarkan SMK3',
    iso45001Clause: 'Klausul 8.1',
    iso45001Title: 'Operational Planning and Control',
    totalCriteriaAwal: 22,
    totalCriteriaTransisi: 41,
    totalCriteriaLanjutan: 53,
    criteriaActive: 53,
    passedCriteria: 49,
    failedCriteria: 4,
    complianceRate: 92,
  },
  {
    elementNumber: 7,
    elementName: 'Standar Pemantauan & Riksa Uji',
    iso45001Clause: 'Klausul 9.1',
    iso45001Title: 'Monitoring, Measurement, Analysis',
    totalCriteriaAwal: 6,
    totalCriteriaTransisi: 14,
    totalCriteriaLanjutan: 18,
    criteriaActive: 18,
    passedCriteria: 16,
    failedCriteria: 2,
    complianceRate: 89,
  },
  {
    elementNumber: 8,
    elementName: 'Pelaporan & Perbaikan Kekurangan (CAPA)',
    iso45001Clause: 'Klausul 10.2',
    iso45001Title: 'Incident, Non-conformity and Corrective Action',
    totalCriteriaAwal: 5,
    totalCriteriaTransisi: 11,
    totalCriteriaLanjutan: 15,
    criteriaActive: 15,
    passedCriteria: 13,
    failedCriteria: 2,
    complianceRate: 87,
  },
  {
    elementNumber: 9,
    elementName: 'Pengelolaan Material & Perpindahannya (BKB)',
    iso45001Clause: 'Klausul 8.1.2',
    iso45001Title: 'Eliminating Hazards & Chemical Controls',
    totalCriteriaAwal: 5,
    totalCriteriaTransisi: 8,
    totalCriteriaLanjutan: 11,
    criteriaActive: 11,
    passedCriteria: 10,
    failedCriteria: 1,
    complianceRate: 91,
  },
  {
    elementNumber: 10,
    elementName: 'Pengumpulan & Penggunaan Data K3',
    iso45001Clause: 'Klausul 9.1.1',
    iso45001Title: 'General Data & Safety KPI Analysis',
    totalCriteriaAwal: 2,
    totalCriteriaTransisi: 4,
    totalCriteriaLanjutan: 6,
    criteriaActive: 6,
    passedCriteria: 6,
    failedCriteria: 0,
    complianceRate: 100,
  },
  {
    elementNumber: 11,
    elementName: 'Audit SMK3 Berkala',
    iso45001Clause: 'Klausul 9.2',
    iso45001Title: 'Internal and External Audit',
    totalCriteriaAwal: 1,
    totalCriteriaTransisi: 3,
    totalCriteriaLanjutan: 5,
    criteriaActive: 5,
    passedCriteria: 4,
    failedCriteria: 1,
    complianceRate: 80,
  },
  {
    elementNumber: 12,
    elementName: 'Pengembangan Keterampilan & Lisensi K3',
    iso45001Clause: 'Klausul 7.2 & 7.3',
    iso45001Title: 'Competency & Awareness (SIO/SKK)',
    totalCriteriaAwal: 5,
    totalCriteriaTransisi: 11,
    totalCriteriaLanjutan: 12,
    criteriaActive: 12,
    passedCriteria: 11,
    failedCriteria: 1,
    complianceRate: 92,
  },
];

/**
 * Calculates chemical hazard status and cumulative ratio according to Kepmenaker 187/1999.
 */
export function calculateChemicalHazardStatus(inventory: ChemicalInventoryItem[]): {
  chemicalHazardStatus: ChemicalHazardStatus;
  cumulativeRatio: number;
  enrichedInventory: ChemicalInventoryItem[];
} {
  let cumulativeRatio = 0;
  const enrichedInventory = inventory.map((item) => {
    const nak = item.thresholdNakKg > 0 ? item.thresholdNakKg : 100_000;
    const ratio = Number((item.quantityStoredKg / nak).toFixed(4));
    cumulativeRatio += ratio;
    return {
      ...item,
      thresholdNakKg: nak,
      ratio,
    };
  });

  cumulativeRatio = Number(cumulativeRatio.toFixed(4));

  // Kepmenaker 187/1999: Sum of (q_i / NAK_i) > 1 or any single q_i >= NAK_i means Major Hazard
  const hasSingleExceed = enrichedInventory.some((i) => i.ratio >= 1.0);
  const isMajorHazard = cumulativeRatio > 1.0 || hasSingleExceed;

  return {
    chemicalHazardStatus: isMajorHazard ? 'POTENSI_BAHAYA_BESAR' : 'POTENSI_BAHAYA_MENENGAH',
    cumulativeRatio,
    enrichedInventory,
  };
}

/**
 * Calculates SMK3 overall score and award status according to PP 50/2012 Lampiran II.
 */
export function calculateSmk3ComplianceScore(
  targetLevel: Smk3AuditLevel,
  elementsMap: Smk3ElementMapping[],
  openActions: CorrectiveAction[] = []
): {
  totalCriteriaActive: number;
  totalPassedCriteria: number;
  totalFailedCriteria: number;
  overallScorePercent: number;
  awardStatus: Smk3AwardStatus;
  hasDisqualifyingCriticalFinding: boolean;
  elements: Smk3ElementMapping[];
} {
  let totalActive = 0;
  let totalPassed = 0;

  const elements = (elementsMap && elementsMap.length === 12 ? elementsMap : DEFAULT_SMK3_ELEMENTS).map((elem) => {
    let active = elem.totalCriteriaLanjutan;
    if (targetLevel === 'AWAL_64') active = elem.totalCriteriaAwal;
    else if (targetLevel === 'TRANSISI_122') active = elem.totalCriteriaTransisi;

    // Scale passed proportionally if criteria count changed
    const ratio = elem.criteriaActive > 0 ? elem.passedCriteria / elem.criteriaActive : 0.9;
    const passed = Math.min(active, Math.round(active * ratio));
    const failed = active - passed;
    const rate = active > 0 ? Math.round((passed / active) * 100) : 100;

    totalActive += active;
    totalPassed += passed;

    return {
      ...elem,
      criteriaActive: active,
      passedCriteria: passed,
      failedCriteria: failed,
      complianceRate: rate,
    };
  });

  const totalFailed = totalActive - totalPassed;
  const overallScorePercent = totalActive > 0 ? Math.round((totalPassed / totalActive) * 100) : 100;

  // Hard Constraint PP 50/2012: Temuan Kritikal / Fatal membatalkan kelayakan penerapan standar
  const hasDisqualifyingCriticalFinding = openActions.some(
    (a) => a.severity === 'critical' && a.status !== 'CLOSED' && a.status !== 'CANCELLED'
  );

  let awardStatus: Smk3AwardStatus = 'KURANG';
  if (hasDisqualifyingCriticalFinding) {
    awardStatus = 'DISQUALIFIED_CRITICAL_FINDING';
  } else if (overallScorePercent >= 85) {
    awardStatus = 'MEMUASKAN_EMAS';
  } else if (overallScorePercent >= 60) {
    awardStatus = 'BAIK_PERAK';
  } else {
    awardStatus = 'KURANG';
  }

  return {
    totalCriteriaActive: totalActive,
    totalPassedCriteria: totalPassed,
    totalFailedCriteria: totalFailed,
    overallScorePercent,
    awardStatus,
    hasDisqualifyingCriticalFinding,
    elements,
  };
}

