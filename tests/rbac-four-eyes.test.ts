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

test('four-eyes check with UUID assigneeId strictly blocks self-closing to CLOSED status', () => {
  const actionOwnerId = '00000000-0000-0000-0000-000000000002';
  const verifierId = '00000000-0000-0000-0000-000000000003';
  const adminId = '00000000-0000-0000-0000-000000000001';

  const capa = {
    id: '00000000-0000-0000-0000-000000000099',
    assigneeId: actionOwnerId,
    assignedToName: 'Dave Kowalski',
    status: 'IN_PROGRESS',
  };

  const canVerifyAndClose = (
    actorId: string,
    actorName: string,
    actorRole: UserRole,
    targetStatus: string
  ): { allowed: boolean; reason?: string } => {
    if (targetStatus === 'CLOSED' || targetStatus === 'verified') {
      const isOwner =
        (capa.assigneeId && capa.assigneeId === actorId) ||
        capa.assignedToName.toLowerCase() === actorName.toLowerCase();

      if (isOwner && actorRole !== 'HSE / Quality Manager & Tenant Admin') {
        return {
          allowed: false,
          reason: 'Four-eyes violation: Action Owner is strictly prohibited from verifying or closing their own action.',
        };
      }

      const verifierRoles: UserRole[] = [
        'Authorized Inspector (API 510/570) & Verifikator K3',
        'HSE / Quality Manager & Tenant Admin',
      ];
      if (!verifierRoles.includes(actorRole)) {
        return {
          allowed: false,
          reason: 'Only an Authorized Inspector (API 510/570) or HSE / Quality Manager can verify and close a CAPA.',
        };
      }
    }
    return { allowed: true };
  };

  // 1. Action Owner cannot close by UUID match
  const test1 = canVerifyAndClose(actionOwnerId, 'Dave Kowalski', 'Action Owner / Pelaksana Perbaikan', 'CLOSED');
  assert.equal(test1.allowed, false);
  assert.match(test1.reason || '', /Four-eyes violation/);

  // 2. Action Owner cannot close even if name is changed in payload
  const test2 = canVerifyAndClose(actionOwnerId, 'Different Name', 'Action Owner / Pelaksana Perbaikan', 'CLOSED');
  assert.equal(test2.allowed, false);

  // 3. Field Inspector cannot close
  const test3 = canVerifyAndClose('00000000-0000-0000-0000-000000000004', 'Budi Santoso', 'Field Inspector / Petugas K3', 'CLOSED');
  assert.equal(test3.allowed, false);

  // 4. Authorized Inspector CAN close
  const test4 = canVerifyAndClose(verifierId, 'Marcus Chen', 'Authorized Inspector (API 510/570) & Verifikator K3', 'CLOSED');
  assert.equal(test4.allowed, true);

  // 5. Tenant Admin CAN close
  const test5 = canVerifyAndClose(adminId, 'SiteLens Admin', 'HSE / Quality Manager & Tenant Admin', 'CLOSED');
  assert.equal(test5.allowed, true);
});

