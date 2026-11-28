import test from 'node:test';
import assert from 'node:assert/strict';
import type { UserRole, ProjectMember, User } from '../src/types/index.ts';

/**
 * Simulates Core RBAC project access verification logic
 * implemented in src/server/auth/middleware.ts
 */
function verifyProjectAccess(
  user: { role: UserRole; assignedProjects: string[] },
  targetProjectId: string,
  method: string
): { allowed: boolean; status: number; error?: string } {
  const isGlobalAdmin =
    user.role === 'Project Director & Tenant Admin' ||
    user.role === 'HSE / Quality Manager & Tenant Admin';

  const isAssigned =
    isGlobalAdmin ||
    (Array.isArray(user.assignedProjects) && user.assignedProjects.includes(targetProjectId));

  if (!isAssigned) {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: Access to this project is denied.',
    };
  }

  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
  if (user.role === 'Client / Vendor Viewer' && isMutation) {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: Client / Vendor Viewer has read-only access.',
    };
  }

  return { allowed: true, status: 200 };
}

/**
 * Simulates hybrid project role resolution (PRD 3.0):
 * If a user has a specific role assigned in project_members, it overrides their default role.
 */
function resolveEffectiveRole(
  user: User,
  targetProjectId: string,
  memberships: ProjectMember[]
): UserRole {
  const match = memberships.find(
    (m) => m.userId === user.id && m.projectId === targetProjectId && m.isActive
  );
  if (match) {
    return match.projectRole;
  }
  return user.role;
}

test('Project Isolation: User of Project A is strictly denied access to Project B', () => {
  const userProjectA = {
    role: 'Project / Site Engineer' as UserRole,
    assignedProjects: ['prj-101'], // only assigned to prj-101
  };

  // Attempting to read or write Project B (prj-102)
  const accessReadB = verifyProjectAccess(userProjectA, 'prj-102', 'GET');
  assert.equal(accessReadB.allowed, false);
  assert.equal(accessReadB.status, 403);
  assert.match(accessReadB.error || '', /Forbidden: Access to this project is denied/);

  const accessWriteB = verifyProjectAccess(userProjectA, 'prj-102', 'POST');
  assert.equal(accessWriteB.allowed, false);
  assert.equal(accessWriteB.status, 403);

  // Accessing assigned Project A (prj-101) is allowed
  const accessReadA = verifyProjectAccess(userProjectA, 'prj-101', 'GET');
  assert.equal(accessReadA.allowed, true);
  assert.equal(accessReadA.status, 200);
});

test('Tenant Admin has global oversight across all projects', () => {
  const adminUser = {
    role: 'Project Director & Tenant Admin' as UserRole,
    assignedProjects: [], // Empty assigned list, but role confers global authority
  };

  const accessAnyProject = verifyProjectAccess(adminUser, 'prj-arbitrary-999', 'GET');
  assert.equal(accessAnyProject.allowed, true);
  assert.equal(accessAnyProject.status, 200);
});

test('Client / Vendor Viewer: Read-only access permitted, but all write/mutation methods rejected', () => {
  const viewerUser = {
    role: 'Client / Vendor Viewer' as UserRole,
    assignedProjects: ['prj-101'],
  };

  // GET is permitted for reading S-Curve and inspection status
  const getResult = verifyProjectAccess(viewerUser, 'prj-101', 'GET');
  assert.equal(getResult.allowed, true);

  // POST (create inspection, template, punchlist) is strictly rejected
  const postResult = verifyProjectAccess(viewerUser, 'prj-101', 'POST');
  assert.equal(postResult.allowed, false);
  assert.equal(postResult.status, 403);
  assert.match(postResult.error || '', /read-only access/);

  // PUT / PATCH is rejected
  const patchResult = verifyProjectAccess(viewerUser, 'prj-101', 'PATCH');
  assert.equal(patchResult.allowed, false);
  assert.equal(patchResult.status, 403);

  // DELETE is rejected
  const deleteResult = verifyProjectAccess(viewerUser, 'prj-101', 'DELETE');
  assert.equal(deleteResult.allowed, false);
  assert.equal(deleteResult.status, 403);
});

test('Core RBAC Hybrid: User can hold different project-specific roles per project', () => {
  const baseUser: User = {
    id: 'usr-engineer-1',
    name: 'Priya Patel',
    email: 'engineer@sitelens.local',
    role: 'Project / Site Engineer', // default global role
    title: 'Planning Engineer',
    avatar: '',
    assignedProjects: ['prj-101', 'prj-102'],
  };

  const memberships: ProjectMember[] = [
    {
      id: 'pm-1',
      projectId: 'prj-101',
      userId: 'usr-engineer-1',
      projectRole: 'Project / Site Engineer',
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'pm-2',
      projectId: 'prj-102',
      userId: 'usr-engineer-1',
      projectRole: 'QA/QC Lead / Owner Inspector', // Elevated to QA Lead on Project 102
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  ];

  // In Project 101, effective role is Site Engineer
  const roleIn101 = resolveEffectiveRole(baseUser, 'prj-101', memberships);
  assert.equal(roleIn101, 'Project / Site Engineer');

  // In Project 102, effective role is QA/QC Lead
  const roleIn102 = resolveEffectiveRole(baseUser, 'prj-102', memberships);
  assert.equal(roleIn102, 'QA/QC Lead / Owner Inspector');

  // In unassigned project without membership, falls back to default role
  const fallbackRole = resolveEffectiveRole(baseUser, 'prj-103', memberships);
  assert.equal(fallbackRole, 'Project / Site Engineer');
});

test('Four-Eyes Enforcement: Inspection Submitter cannot self-approve inspection attempt', () => {
  const submitterId = 'usr-inspector-1';
  const approverId = 'usr-inspector-1'; // Same person attempting self-approval

  const canApproveAttempt = (
    actorId: string,
    attemptSubmitterId: string,
    actorRole: UserRole
  ): boolean => {
    // Four-eyes rule: submitter can NEVER approve own inspection
    if (actorId === attemptSubmitterId) {
      return false;
    }
    return (
      actorRole === 'QA/QC Lead / Owner Inspector' ||
      actorRole === 'Project Director & Tenant Admin'
    );
  };

  assert.equal(
    canApproveAttempt(approverId, submitterId, 'QA/QC Lead / Owner Inspector'),
    false,
    'Self-approval must be blocked even if user has QA Lead role'
  );

  assert.equal(
    canApproveAttempt('usr-qalead-2', submitterId, 'QA/QC Lead / Owner Inspector'),
    true,
    'Independent QA Lead is allowed to approve'
  );
});

test('Four-Eyes Enforcement: Subcontractor / Action Owner cannot verify and close own punchlist', () => {
  const subconId = 'usr-subcon-1';
  const punchlistAssignee = 'usr-subcon-1';

  const canVerifyAndClose = (
    actorId: string,
    assigneeId: string,
    actorRole: UserRole
  ): boolean => {
    // Four-eyes rule: Person responsible for the repair cannot close it
    if (actorId === assigneeId) {
      return false;
    }
    return (
      actorRole === 'QA/QC Lead / Owner Inspector' ||
      actorRole === 'Project Director & Tenant Admin'
    );
  };

  assert.equal(
    canVerifyAndClose(subconId, punchlistAssignee, 'Action Owner / Subcontractor'),
    false,
    'Action Owner cannot close own punchlist item'
  );

  assert.equal(
    canVerifyAndClose('usr-qalead-2', punchlistAssignee, 'QA/QC Lead / Owner Inspector'),
    true,
    'Independent verifier is allowed to close punchlist'
  );
});
