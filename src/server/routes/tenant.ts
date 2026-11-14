import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '../db/index.ts';
import { tenantProfiles, correctiveActions, auditLogs } from '../db/schema.ts';
import { requireAuth } from '../auth/middleware.ts';
import {
  STANDARD_NAK_REFERENCE,
  DEFAULT_SMK3_ELEMENTS,
  calculateChemicalHazardStatus,
  calculateSmk3ComplianceScore,
} from '../services/compliance.ts';
import type { ChemicalInventoryItem, TenantProfile, Smk3AuditLevel } from '../../types/index.ts';

export const tenantRouter = Router();

tenantRouter.use(requireAuth);

async function getOrCreateTenantProfile() {
  const db = getDb();
  if (!db) return null;

  const [existing] = await db.select().from(tenantProfiles).limit(1);
  if (existing) return existing;

  // Initial seed chemical inventory for testing
  const initialChemicals: ChemicalInventoryItem[] = [
    {
      id: crypto.randomUUID(),
      name: 'Diesel Fuel Depot Skid #2',
      casNumber: '68334-30-5',
      category: 'Flammable',
      quantityStoredKg: 45_000,
      thresholdNakKg: 200_000,
      ratio: 0.225,
    },
    {
      id: crypto.randomUUID(),
      name: 'Water Treatment Chlorine Cylinder',
      casNumber: '7782-50-5',
      category: 'Toxic',
      quantityStoredKg: 2_500,
      thresholdNakKg: 10_000,
      ratio: 0.25,
    },
  ];

  const { chemicalHazardStatus, enrichedInventory } = calculateChemicalHazardStatus(initialChemicals);

  const [created] = await db
    .insert(tenantProfiles)
    .values({
      companyName: 'SiteLens Enterprise Facilities',
      facilityLocation: 'Balikpapan Process Terminal Sector 4',
      workforceCount: 150,
      riskLevel: 'HIGH',
      targetSmk3Level: 'LANJUTAN_166',
      chemicalHazardStatus,
      chemicalInventory: enrichedInventory,
      majorHazardDocUploaded: false,
      ahliK3KimiaCount: 2,
      petugasK3KimiaCount: 3,
      expiryAlertDays: 60,
      smk3ElementsMap: DEFAULT_SMK3_ELEMENTS,
    })
    .returning();

  return created;
}

// ---------------- GET TENANT PROFILE & COMPLIANCE STATS ----------------

tenantRouter.get('/profile', async (_req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const profile = await getOrCreateTenantProfile();
  if (!profile) {
    res.status(500).json({ error: 'Could not load tenant profile.' });
    return;
  }

  // Load all actions to check for disqualifying critical findings
  const allActions = await db.select().from(correctiveActions);
  const activeActions = allActions.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
    resolvedAt: a.resolvedAt?.toISOString(),
  }));

  const { chemicalHazardStatus, cumulativeRatio, enrichedInventory } = calculateChemicalHazardStatus(
    (profile.chemicalInventory as ChemicalInventoryItem[]) || []
  );

  const smk3Result = calculateSmk3ComplianceScore(
    profile.targetSmk3Level as Smk3AuditLevel,
    profile.smk3ElementsMap || DEFAULT_SMK3_ELEMENTS,
    activeActions
  );

  const response: TenantProfile = {
    id: profile.id,
    companyName: profile.companyName,
    facilityLocation: profile.facilityLocation,
    workforceCount: profile.workforceCount,
    riskLevel: profile.riskLevel,
    targetSmk3Level: profile.targetSmk3Level,
    chemicalHazardStatus,
    chemicalCumulativeRatio: cumulativeRatio,
    chemicalInventory: enrichedInventory,
    majorHazardDocUploaded: profile.majorHazardDocUploaded,
    ahliK3KimiaCount: profile.ahliK3KimiaCount,
    petugasK3KimiaCount: profile.petugasK3KimiaCount,
    lastChemicalInspectionDate: profile.lastChemicalInspectionDate?.toISOString(),
    nextEmergencyDrillDate: profile.nextEmergencyDrillDate?.toISOString(),
    expiryAlertDays: profile.expiryAlertDays,
    smk3AwardStatus: smk3Result.awardStatus,
    smk3OverallScorePercent: smk3Result.overallScorePercent,
    smk3ElementsMap: smk3Result.elements,
    updatedAt: profile.updatedAt.toISOString(),
  };

  res.json({
    profile: response,
    complianceAudit: {
      totalCriteriaActive: smk3Result.totalCriteriaActive,
      totalPassedCriteria: smk3Result.totalPassedCriteria,
      totalFailedCriteria: smk3Result.totalFailedCriteria,
      hasDisqualifyingCriticalFinding: smk3Result.hasDisqualifyingCriticalFinding,
    },
  });
});

// ---------------- UPDATE TENANT PROFILE (TENANT ADMIN ONLY) ----------------

tenantRouter.put('/profile', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  if (req.authUser.role !== 'HSE / Quality Manager & Tenant Admin') {
    res.status(403).json({ error: 'Forbidden: Only HSE / Quality Manager & Tenant Admin can update tenant compliance profile.' });
    return;
  }

  const profile = await getOrCreateTenantProfile();
  if (!profile) {
    res.status(500).json({ error: 'Tenant profile not found.' });
    return;
  }

  const {
    companyName,
    facilityLocation,
    workforceCount,
    riskLevel,
    targetSmk3Level,
    majorHazardDocUploaded,
    ahliK3KimiaCount,
    petugasK3KimiaCount,
    lastChemicalInspectionDate,
    nextEmergencyDrillDate,
    expiryAlertDays,
  } = req.body ?? {};

  const [updated] = await db
    .update(tenantProfiles)
    .set({
      companyName: companyName !== undefined ? String(companyName).trim() : profile.companyName,
      facilityLocation: facilityLocation !== undefined ? String(facilityLocation).trim() : profile.facilityLocation,
      workforceCount: workforceCount !== undefined ? Number(workforceCount) : profile.workforceCount,
      riskLevel: riskLevel !== undefined ? riskLevel : profile.riskLevel,
      targetSmk3Level: targetSmk3Level !== undefined ? targetSmk3Level : profile.targetSmk3Level,
      majorHazardDocUploaded:
        majorHazardDocUploaded !== undefined ? Boolean(majorHazardDocUploaded) : profile.majorHazardDocUploaded,
      ahliK3KimiaCount: ahliK3KimiaCount !== undefined ? Number(ahliK3KimiaCount) : profile.ahliK3KimiaCount,
      petugasK3KimiaCount: petugasK3KimiaCount !== undefined ? Number(petugasK3KimiaCount) : profile.petugasK3KimiaCount,
      lastChemicalInspectionDate: lastChemicalInspectionDate ? new Date(lastChemicalInspectionDate) : profile.lastChemicalInspectionDate,
      nextEmergencyDrillDate: nextEmergencyDrillDate ? new Date(nextEmergencyDrillDate) : profile.nextEmergencyDrillDate,
      expiryAlertDays: expiryAlertDays !== undefined ? Number(expiryAlertDays) : profile.expiryAlertDays,
      updatedAt: new Date(),
    })
    .where(eq(tenantProfiles.id, profile.id))
    .returning();

  await db.insert(auditLogs).values({
    actorId: req.authUser.id,
    actorName: req.authUser.name,
    action: 'UPDATE_TENANT_PROFILE',
    entityType: 'tenant_profile',
    entityId: updated.id,
    metadata: {
      targetSmk3Level: updated.targetSmk3Level,
      workforceCount: updated.workforceCount,
    },
  });

  res.json({ success: true, profile: updated });
});

// ---------------- CHEMICAL INVENTORY MANAGEMENT ----------------

tenantRouter.post('/chemicals', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  if (req.authUser.role !== 'HSE / Quality Manager & Tenant Admin') {
    res.status(403).json({ error: 'Forbidden: Only HSE / Quality Manager & Tenant Admin can modify chemical inventory.' });
    return;
  }

  const profile = await getOrCreateTenantProfile();
  if (!profile) {
    res.status(500).json({ error: 'Tenant profile not found.' });
    return;
  }

  const { name, casNumber, category, quantityStoredKg, thresholdNakKg } = req.body ?? {};
  if (!name || !quantityStoredKg || !thresholdNakKg) {
    res.status(400).json({ error: 'name, quantityStoredKg, and thresholdNakKg are required.' });
    return;
  }

  const currentInventory = (profile.chemicalInventory as ChemicalInventoryItem[]) || [];
  const newItem: ChemicalInventoryItem = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    casNumber: casNumber ? String(casNumber).trim() : undefined,
    category: category || 'Other',
    quantityStoredKg: Number(quantityStoredKg),
    thresholdNakKg: Number(thresholdNakKg),
    ratio: Number((Number(quantityStoredKg) / Number(thresholdNakKg)).toFixed(4)),
  };

  const updatedInventory = [...currentInventory, newItem];
  const { chemicalHazardStatus, enrichedInventory } = calculateChemicalHazardStatus(updatedInventory);

  const [updated] = await db
    .update(tenantProfiles)
    .set({
      chemicalInventory: enrichedInventory,
      chemicalHazardStatus,
      updatedAt: new Date(),
    })
    .where(eq(tenantProfiles.id, profile.id))
    .returning();

  res.status(201).json({
    item: newItem,
    chemicalHazardStatus,
    inventory: updated.chemicalInventory,
  });
});

tenantRouter.delete('/chemicals/:id', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  if (req.authUser.role !== 'HSE / Quality Manager & Tenant Admin') {
    res.status(403).json({ error: 'Forbidden: Only HSE / Quality Manager & Tenant Admin can modify chemical inventory.' });
    return;
  }

  const profile = await getOrCreateTenantProfile();
  if (!profile) {
    res.status(500).json({ error: 'Tenant profile not found.' });
    return;
  }

  const currentInventory = (profile.chemicalInventory as ChemicalInventoryItem[]) || [];
  const filtered = currentInventory.filter((i) => i.id !== req.params.id);

  const { chemicalHazardStatus, enrichedInventory } = calculateChemicalHazardStatus(filtered);

  const [updated] = await db
    .update(tenantProfiles)
    .set({
      chemicalInventory: enrichedInventory,
      chemicalHazardStatus,
      updatedAt: new Date(),
    })
    .where(eq(tenantProfiles.id, profile.id))
    .returning();

  res.json({
    success: true,
    chemicalHazardStatus,
    inventory: updated.chemicalInventory,
  });
});

// ---------------- REFERENCE DATA ----------------

tenantRouter.get('/reference-nak', (_req: Request, res: Response) => {
  res.json({ referenceNak: STANDARD_NAK_REFERENCE });
});

tenantRouter.get('/smk3-matrix', (_req: Request, res: Response) => {
  res.json({ smk3Elements: DEFAULT_SMK3_ELEMENTS });
});

