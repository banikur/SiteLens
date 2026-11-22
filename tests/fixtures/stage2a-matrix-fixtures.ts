/**
 * Shared fixture data for Stage 2a RBAC matrix tests.
 * Deterministic IDs — no Argon2, no random UUIDs at runtime.
 */
import { hashSessionToken, hashSecret } from '../../src/server/auth/crypto.ts';

// ---------------------------------------------------------------------------
// Project IDs
// ---------------------------------------------------------------------------
export const PRJ_A_ID     = 'aaaaaaaa-1111-4111-8111-111111111111';
export const PRJ_B_ID     = 'bbbbbbbb-2222-4222-8222-222222222222';
export const PRJ_PRESET_ID = 'cccccccc-3333-4333-8333-333333333333';

// ---------------------------------------------------------------------------
// Fixture entity IDs
// ---------------------------------------------------------------------------
export const NODE_A_ID               = '11111111-aaaa-4aaa-8aaa-111111111111';
export const NODE_B_ID               = '22222222-bbbb-4bbb-8bbb-222222222222';
export const NODE_FOR_INIT_WORKFLOW_ID = '11111111-eeee-4eee-8eee-111111111111';
export const NODE_TO_DELETE_ID       = '11111111-dddd-4ddd-8ddd-111111111111';

export const WORKFLOW_A_ID    = '33333333-aaaa-4aaa-8aaa-333333333333';
export const STAGE_A_ID       = '44444444-aaaa-4aaa-8aaa-444444444444';
export const ATTEMPT_A_ID     = '55555555-aaaa-4aaa-8aaa-555555555555';

export const TEMPLATE_A_ID         = '66666666-aaaa-4aaa-8aaa-666666666666';
export const TEMPLATE_TO_DELETE_ID = '66666666-dddd-4ddd-8ddd-666666666666';

export const INSPECTION_A_ID         = '77777777-aaaa-4aaa-8aaa-777777777777';
export const INSPECTION_TO_DELETE_ID = '77777777-dddd-4ddd-8ddd-777777777777';

export const ACTION_A_ID       = '88888888-aaaa-4aaa-8aaa-888888888888';
export const CHEMICAL_A_ID     = '99999999-aaaa-4aaa-8aaa-999999999999';
export const CHEMICAL_TO_DELETE_ID = '99999999-dddd-4ddd-8ddd-999999999999';

// ---------------------------------------------------------------------------
// Role user map — deterministic tokens, pre-hashed by crypto helper
// ---------------------------------------------------------------------------
export const ROLE_KEYS = [
  'field_inspector',
  'subcontractor',
  'site_engineer',
  'qaqc_lead',
  'project_manager',
  'head_office_pmo',
  'client_viewer',
] as const;

export type BuiltinRoleKey = typeof ROLE_KEYS[number];

export interface RoleUserMeta {
  id: string;
  email: string;
  username: string;
  /** Raw token string — set as Cookie `sitelens_session=<token>` */
  token: string;
  /** SHA-256 hash — stored directly in `sessions.id` */
  sessionId: string;
}

/** Pre-compute sessionId at import time (pure SHA-256, no Argon2). */
function makeMeta(id: string, role: string, num: string): RoleUserMeta {
  const token = `token-${role}-${num}`;
  return { id, email: `${role}@sitelens.local`, username: `user_${role}`, token, sessionId: hashSessionToken(token) };
}

export const ROLE_USER_MAP: Record<BuiltinRoleKey, RoleUserMeta> = {
  field_inspector:  makeMeta('10000000-0000-4000-8000-000000000001', 'field-inspector',  '00000000000000000001'),
  subcontractor:    makeMeta('10000000-0000-4000-8000-000000000002', 'subcontractor',    '00000000000000000002'),
  site_engineer:    makeMeta('10000000-0000-4000-8000-000000000003', 'site-engineer',    '00000000000000000003'),
  qaqc_lead:        makeMeta('10000000-0000-4000-8000-000000000004', 'qaqc-lead',        '00000000000000000004'),
  project_manager:  makeMeta('10000000-0000-4000-8000-000000000005', 'project-manager',  '00000000000000000005'),
  head_office_pmo:  makeMeta('10000000-0000-4000-8000-000000000006', 'head-office-pmo',  '00000000000000000006'),
  client_viewer:    makeMeta('10000000-0000-4000-8000-000000000007', 'client-viewer',    '00000000000000000007'),
};

/** Single reusable password hash (Argon2 computed once). */
export const SHARED_PASSWORD_HASH = hashSecret('secret123');
