import 'dotenv/config';
import { getDb, closeDb } from './index.ts';
import { seedLegacyRoleAssignments } from '../auth/rbac.ts';

async function main() {
  console.log('Seeding RBAC permissions, built-in roles, and legacy assignments...');
  const db = getDb();
  if (!db) {
    console.error('Database connection failed.');
    process.exit(1);
  }

  await seedLegacyRoleAssignments();
  console.log('RBAC seed completed successfully.');
  await closeDb();
}

main().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
