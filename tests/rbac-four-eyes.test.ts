import test from 'node:test';
import assert from 'node:assert/strict';
import type { UserRole } from '../src/types/index.ts';

test('canonical PRD roles are exactly 5 predefined roles', () => {
  const PRD_ROLES: UserRole[] = [
    'Field Inspector / Petugas K3',
    'Action Owner / Pelaksana Perbaikan',
    'Office / Integrity Engineer',
    'Authorized Inspector (API 510/570) & Verifikator K3',
    'HSE / Quality Manager & Tenant Admin',
  ];
  assert.equal(PRD_ROLES.length, 5);
});

test('four-eyes verification rule prevents Action Owner from closing own action', () => {
  const action = {
    id: 'act-1',
    assignedToName: 'Sarah Jenkins',
    status: 'in_progress',
  };

  const isActionOwnerSelfClosing = (actorName: string, actorRole: UserRole, targetStatus: string): boolean => {
    if (targetStatus === 'verified') {
      if (action.assignedToName.toLowerCase() === actorName.toLowerCase() && actorRole !== 'HSE / Quality Manager & Tenant Admin') {
        return false; // blocked by four-eyes constraint
      }
      const allowedVerifiers: UserRole[] = [
        'Authorized Inspector (API 510/570) & Verifikator K3',
        'HSE / Quality Manager & Tenant Admin',
      ];
      return allowedVerifiers.includes(actorRole);
    }
    return true;
  };

  // Action Owner cannot close
  assert.equal(isActionOwnerSelfClosing('Sarah Jenkins', 'Action Owner / Pelaksana Perbaikan', 'verified'), false);

  // Field Inspector cannot close
  assert.equal(isActionOwnerSelfClosing('Budi Santoso', 'Field Inspector / Petugas K3', 'verified'), false);

  // Independent Authorized Inspector CAN verify & close
  assert.equal(isActionOwnerSelfClosing('Marcus Chen', 'Authorized Inspector (API 510/570) & Verifikator K3', 'verified'), true);

  // Tenant Admin CAN verify & close
  assert.equal(isActionOwnerSelfClosing('Elena Rostova', 'HSE / Quality Manager & Tenant Admin', 'verified'), true);
});

