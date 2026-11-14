import type {
  TenantProfile,
  ChemicalInventoryItem,
  Smk3AuditLevel,
} from '../types';
import {
  DEFAULT_SMK3_ELEMENTS,
  STANDARD_NAK_REFERENCE,
  calculateChemicalHazardStatus,
  calculateSmk3ComplianceScore,
} from '../server/services/compliance.ts';

const TENANT_LOCAL_KEY = 'sitelens_tenant_profile_v1';

export function getLocalTenantProfile(): TenantProfile {
  try {
    const raw = localStorage.getItem(TENANT_LOCAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }

  const initialChemicals: ChemicalInventoryItem[] = [
    {
      id: 'chem-1',
      name: 'Diesel Fuel Depot Skid #2',
      casNumber: '68334-30-5',
      category: 'Flammable',
      quantityStoredKg: 45_000,
      thresholdNakKg: 200_000,
      ratio: 0.225,
    },
    {
      id: 'chem-2',
      name: 'Water Treatment Chlorine Cylinder',
      casNumber: '7782-50-5',
      category: 'Toxic',
      quantityStoredKg: 2_500,
      thresholdNakKg: 10_000,
      ratio: 0.25,
    },
  ];

  const { chemicalHazardStatus, cumulativeRatio, enrichedInventory } = calculateChemicalHazardStatus(initialChemicals);
  const smk3 = calculateSmk3ComplianceScore('LANJUTAN_166', DEFAULT_SMK3_ELEMENTS, []);

  const profile: TenantProfile = {
    id: '00000000-0000-0000-0000-000000000001',
    companyName: 'SiteLens Enterprise Facilities',
    facilityLocation: 'Balikpapan Process Terminal Sector 4',
    workforceCount: 150,
    riskLevel: 'HIGH',
    targetSmk3Level: 'LANJUTAN_166',
    chemicalHazardStatus,
    chemicalCumulativeRatio: cumulativeRatio,
    chemicalInventory: enrichedInventory,
    majorHazardDocUploaded: false,
    ahliK3KimiaCount: 2,
    petugasK3KimiaCount: 3,
    expiryAlertDays: 60,
    smk3AwardStatus: smk3.awardStatus,
    smk3OverallScorePercent: smk3.overallScorePercent,
    smk3ElementsMap: smk3.elements,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(TENANT_LOCAL_KEY, JSON.stringify(profile));
  return profile;
}

export function saveLocalTenantProfile(profile: TenantProfile): TenantProfile {
  const { chemicalHazardStatus, cumulativeRatio, enrichedInventory } = calculateChemicalHazardStatus(profile.chemicalInventory);
  const smk3 = calculateSmk3ComplianceScore(profile.targetSmk3Level, profile.smk3ElementsMap, []);

  const updated: TenantProfile = {
    ...profile,
    chemicalHazardStatus,
    chemicalCumulativeRatio: cumulativeRatio,
    chemicalInventory: enrichedInventory,
    smk3AwardStatus: smk3.awardStatus,
    smk3OverallScorePercent: smk3.overallScorePercent,
    smk3ElementsMap: smk3.elements,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(TENANT_LOCAL_KEY, JSON.stringify(updated));
  return updated;
}

export async function fetchTenantProfile(): Promise<{ profile: TenantProfile; complianceAudit?: any }> {
  try {
    const res = await fetch('/api/tenant/profile', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem(TENANT_LOCAL_KEY, JSON.stringify(data.profile));
      return data;
    }
  } catch {
    // fallback
  }
  return { profile: getLocalTenantProfile() };
}

export async function updateTenantProfileApi(
  updates: Partial<TenantProfile>
): Promise<TenantProfile> {
  try {
    const res = await fetch('/api/tenant/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const data = await res.json();
      return data.profile;
    }
  } catch {
    // fallback
  }

  const current = getLocalTenantProfile();
  return saveLocalTenantProfile({ ...current, ...updates });
}

export async function addChemicalApi(
  item: Omit<ChemicalInventoryItem, 'id' | 'ratio'>
): Promise<TenantProfile> {
  try {
    const res = await fetch('/api/tenant/chemicals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(item),
    });
    if (res.ok) {
      const { profile } = await fetchTenantProfile();
      return profile;
    }
  } catch {
    // fallback
  }

  const current = getLocalTenantProfile();
  const newItem: ChemicalInventoryItem = {
    id: `chem-${Date.now()}`,
    ...item,
    ratio: Number((item.quantityStoredKg / item.thresholdNakKg).toFixed(4)),
  };
  return saveLocalTenantProfile({
    ...current,
    chemicalInventory: [...current.chemicalInventory, newItem],
  });
}

export async function removeChemicalApi(id: string): Promise<TenantProfile> {
  try {
    const res = await fetch(`/api/tenant/chemicals/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      const { profile } = await fetchTenantProfile();
      return profile;
    }
  } catch {
    // fallback
  }

  const current = getLocalTenantProfile();
  return saveLocalTenantProfile({
    ...current,
    chemicalInventory: current.chemicalInventory.filter((c) => c.id !== id),
  });
}

export { STANDARD_NAK_REFERENCE };

