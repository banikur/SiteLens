import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateChemicalHazardStatus,
  calculateSmk3ComplianceScore,
  DEFAULT_SMK3_ELEMENTS,
  STANDARD_NAK_REFERENCE,
} from '../src/server/services/compliance.ts';
import type { ChemicalInventoryItem, CorrectiveAction } from '../src/types/index.ts';

test('SMK3 criteria counts match PP 50/2012 Lampiran II exactly for all 3 levels', () => {
  const sumAwal = DEFAULT_SMK3_ELEMENTS.reduce((acc, el) => acc + el.totalCriteriaAwal, 0);
  const sumTransisi = DEFAULT_SMK3_ELEMENTS.reduce((acc, el) => acc + el.totalCriteriaTransisi, 0);
  const sumLanjutan = DEFAULT_SMK3_ELEMENTS.reduce((acc, el) => acc + el.totalCriteriaLanjutan, 0);

  assert.equal(sumAwal, 64, 'Tingkat Awal must have exactly 64 criteria');
  assert.equal(sumTransisi, 122, 'Tingkat Transisi must have exactly 122 criteria');
  assert.equal(sumLanjutan, 166, 'Tingkat Lanjutan must have exactly 166 criteria');
  assert.equal(DEFAULT_SMK3_ELEMENTS.length, 12, 'Must contain exactly 12 elements');
});

test('Chemical hazard status correctly classifies POTENSI_BAHAYA_BESAR and POTENSI_BAHAYA_MENENGAH (Kepmenaker 187/1999)', () => {
  // Scenario 1: Below NAK
  const lowHazardItems: ChemicalInventoryItem[] = [
    {
      id: 'c1',
      name: 'Diesel Fuel Depot Skid #1',
      category: 'Flammable',
      quantityStoredKg: 40_000,
      thresholdNakKg: 200_000, // ratio = 0.2
      ratio: 0.2,
    },
    {
      id: 'c2',
      name: 'Chlorine Cylinders',
      category: 'Toxic',
      quantityStoredKg: 2_000,
      thresholdNakKg: 10_000, // ratio = 0.2
      ratio: 0.2,
    },
  ];
  const resLow = calculateChemicalHazardStatus(lowHazardItems);
  assert.equal(resLow.chemicalHazardStatus, 'POTENSI_BAHAYA_MENENGAH');
  assert.equal(resLow.cumulativeRatio, 0.4);

  // Scenario 2: Single chemical exceeding individual NAK
  const singleExceedItems: ChemicalInventoryItem[] = [
    {
      id: 'c3',
      name: 'Bulk Chlorine Tank',
      category: 'Toxic',
      quantityStoredKg: 15_000,
      thresholdNakKg: 10_000, // ratio = 1.5 >= 1.0
      ratio: 1.5,
    },
  ];
  const resSingle = calculateChemicalHazardStatus(singleExceedItems);
  assert.equal(resSingle.chemicalHazardStatus, 'POTENSI_BAHAYA_BESAR');

  // Scenario 3: Cumulative sum > 1.0 even if individual is < 1.0
  const cumulativeExceedItems: ChemicalInventoryItem[] = [
    {
      id: 'c4',
      name: 'LPG Storage Sphere',
      category: 'Flammable',
      quantityStoredKg: 35_000,
      thresholdNakKg: 50_000, // ratio = 0.70
      ratio: 0.7,
    },
    {
      id: 'c5',
      name: 'Ammonia Refrigeration Vessel',
      category: 'Toxic',
      quantityStoredKg: 45_000,
      thresholdNakKg: 100_000, // ratio = 0.45 -> total = 1.15 > 1.0
      ratio: 0.45,
    },
  ];
  const resCumulative = calculateChemicalHazardStatus(cumulativeExceedItems);
  assert.equal(resCumulative.chemicalHazardStatus, 'POTENSI_BAHAYA_BESAR');
  assert.equal(resCumulative.cumulativeRatio, 1.15);
});

test('SMK3 award criteria yields Memuaskan Emas (85%+), Baik Perak (60-84%), and Kurang (<60%)', () => {
  // Scenario 1: High compliance, no open critical findings -> MEMUASKAN_EMAS
  const highResult = calculateSmk3ComplianceScore('LANJUTAN_166', DEFAULT_SMK3_ELEMENTS, []);
  assert.ok(highResult.overallScorePercent >= 85);
  assert.equal(highResult.awardStatus, 'MEMUASKAN_EMAS');

  // Scenario 2: Intermediate compliance -> BAIK_PERAK
  const midElements = DEFAULT_SMK3_ELEMENTS.map((el) => ({
    ...el,
    passedCriteria: Math.floor(el.totalCriteriaLanjutan * 0.7),
    failedCriteria: Math.ceil(el.totalCriteriaLanjutan * 0.3),
    criteriaActive: el.totalCriteriaLanjutan,
    complianceRate: 70,
  }));
  const midResult = calculateSmk3ComplianceScore('LANJUTAN_166', midElements, []);
  assert.ok(midResult.overallScorePercent >= 60 && midResult.overallScorePercent < 85);
  assert.equal(midResult.awardStatus, 'BAIK_PERAK');

  // Scenario 3: Low compliance -> KURANG
  const lowElements = DEFAULT_SMK3_ELEMENTS.map((el) => ({
    ...el,
    passedCriteria: Math.floor(el.totalCriteriaLanjutan * 0.4),
    failedCriteria: Math.ceil(el.totalCriteriaLanjutan * 0.6),
    criteriaActive: el.totalCriteriaLanjutan,
    complianceRate: 40,
  }));
  const lowResult = calculateSmk3ComplianceScore('LANJUTAN_166', lowElements, []);
  assert.ok(lowResult.overallScorePercent < 60);
  assert.equal(lowResult.awardStatus, 'KURANG');
});

test('Hard Constraint PP 50/2012: Open Critical CAPA strictly DISQUALIFIES certification even at 95% score', () => {
  const openCriticalAction: CorrectiveAction = {
    id: '00000000-0000-0000-0000-000000000088',
    inspectionId: '00000000-0000-0000-0000-000000000001',
    inspectionTitle: 'Scaffolding Structural Integrity',
    projectId: '00000000-0000-0000-0000-000000000001',
    projectName: 'Harbor Terminal',
    siteZone: 'Zone 1',
    fieldLabel: 'Base Jack Missing Sole Plate',
    issueDescription: 'Critical collapse risk under heavy vibration load.',
    severity: 'critical',
    assignedToName: 'Dave Kowalski',
    assignedToRole: 'Action Owner / Pelaksana Perbaikan',
    dueDate: '2026-11-20',
    status: 'IN_PROGRESS', // Open critical finding
    createdAt: '2026-11-13',
  };

  const disqualifiedResult = calculateSmk3ComplianceScore(
    'LANJUTAN_166',
    DEFAULT_SMK3_ELEMENTS,
    [openCriticalAction]
  );

  assert.equal(disqualifiedResult.hasDisqualifyingCriticalFinding, true);
  assert.equal(
    disqualifiedResult.awardStatus,
    'DISQUALIFIED_CRITICAL_FINDING',
    'Open critical non-conformance must cancel certificate eligibility'
  );

  // Once closed, certificate eligibility is restored
  const closedAction: CorrectiveAction = {
    ...openCriticalAction,
    status: 'CLOSED',
    resolvedAt: '2026-11-14',
    resolutionNotes: 'Sole plates installed and anchor load tested.',
  };

  const restoredResult = calculateSmk3ComplianceScore(
    'LANJUTAN_166',
    DEFAULT_SMK3_ELEMENTS,
    [closedAction]
  );

  assert.equal(restoredResult.hasDisqualifyingCriticalFinding, false);
  assert.equal(restoredResult.awardStatus, 'MEMUASKAN_EMAS');
});

test('Dual-Compliance: All 12 SMK3 elements map to valid ISO 45001:2018 clauses', () => {
  for (const el of DEFAULT_SMK3_ELEMENTS) {
    assert.match(el.iso45001Clause, /^Klausul (5|6|7|8|9|10)/);
    assert.ok(el.iso45001Title.length > 5);
  }
});

