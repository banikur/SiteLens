import { Client } from 'pg';

export const TEST_DATABASE_URL = 'postgresql://postgres:admin@localhost:5432/sitelens_test';

export async function ensureTestDatabaseSchema() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();

  const check = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  const tables = check.rows.map((r: any) => r.tablename);

  // If table 'projects' has text id or if we are setting up, recreate schema cleanly
  let needsInit = false;
  if (!tables.includes('work_stages') || !tables.includes('evidence_attachments')) {
    needsInit = true;
  } else {
    const colCheck = await client.query(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'id'"
    );
    if (colCheck.rows[0]?.data_type !== 'uuid') {
      needsInit = true;
    }
  }

  if (needsInit) {
    console.log('Initializing clean public schema in sitelens_test...');
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    const DDL = `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE "projects" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "code" text NOT NULL UNIQUE,
        "client" text NOT NULL,
        "location" text NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "lead_manager" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "username" text NOT NULL UNIQUE,
        "name" text NOT NULL,
        "email" text NOT NULL UNIQUE,
        "password_hash" text NOT NULL,
        "pin_hash" text,
        "role" text NOT NULL,
        "title" text NOT NULL,
        "avatar" text DEFAULT '' NOT NULL,
        "assigned_projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "sessions" (
        "id" text PRIMARY KEY,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "expires_at" timestamp with time zone NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "webauthn_credentials" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "credential_id" text NOT NULL UNIQUE,
        "public_key" text NOT NULL,
        "counter" integer DEFAULT 0 NOT NULL,
        "transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "device_name" text DEFAULT 'Registered Device' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "checklist_templates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" text NOT NULL,
        "category" text NOT NULL,
        "description" text NOT NULL,
        "version" text DEFAULT '1.0' NOT NULL,
        "standard_body" text DEFAULT 'Custom' NOT NULL,
        "standard_code" text,
        "document_control_no" text,
        "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
        "target_role" text,
        "requires_approval" boolean DEFAULT false NOT NULL,
        "approval_role" text,
        "workflow_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "estimated_minutes" integer DEFAULT 20 NOT NULL,
        "sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "is_master_template" boolean DEFAULT false NOT NULL,
        "author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "author_name" text NOT NULL,
        "author_role" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "inspections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "client_mutation_id" text UNIQUE,
        "template_id" uuid NOT NULL REFERENCES "checklist_templates"("id") ON DELETE RESTRICT,
        "template_title" text NOT NULL,
        "category" text NOT NULL,
        "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
        "project_name" text NOT NULL,
        "site_zone" text NOT NULL,
        "inspector_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "inspector_name" text NOT NULL,
        "inspector_role" text NOT NULL,
        "status" text DEFAULT 'draft' NOT NULL,
        "current_step_index" integer DEFAULT 0 NOT NULL,
        "approval_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "evidence_photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "signature_data" jsonb,
        "score_percent" integer DEFAULT 0 NOT NULL,
        "passed_count" integer DEFAULT 0 NOT NULL,
        "failed_count" integer DEFAULT 0 NOT NULL,
        "non_applicable_count" integer DEFAULT 0 NOT NULL,
        "notes" text,
        "submitted_at" timestamp with time zone,
        "reviewed_by" text,
        "reviewed_role" text,
        "reviewed_at" timestamp with time zone,
        "review_notes" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "corrective_actions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "inspection_id" uuid REFERENCES "inspections"("id") ON DELETE CASCADE,
        "inspection_title" text NOT NULL,
        "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
        "project_name" text NOT NULL,
        "site_zone" text NOT NULL,
        "field_label" text NOT NULL,
        "issue_description" text NOT NULL,
        "severity" text DEFAULT 'medium' NOT NULL,
        "assignee_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "assigned_to_name" text NOT NULL,
        "assigned_to_role" text NOT NULL,
        "due_date" text NOT NULL,
        "status" text DEFAULT 'OPEN' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "resolved_at" timestamp with time zone,
        "resolution_notes" text,
        "evidence_photo_url" text
      );

      CREATE TABLE "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "actor_name" text NOT NULL,
        "action" text NOT NULL,
        "entity_type" text NOT NULL,
        "entity_id" text NOT NULL,
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "notification_settings" (
        "id" text PRIMARY KEY,
        "smtp_host" text,
        "smtp_port" integer DEFAULT 587,
        "smtp_user" text,
        "smtp_pass" text,
        "smtp_from" text,
        "webhook_url" text,
        "webhook_type" text DEFAULT 'generic'
      );

      CREATE TABLE "tenant_profiles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_name" text NOT NULL,
        "facility_location" text NOT NULL,
        "workforce_count" integer DEFAULT 50 NOT NULL,
        "risk_level" text DEFAULT 'HIGH' NOT NULL,
        "target_smk3_level" text DEFAULT 'AWAL_64' NOT NULL,
        "chemical_hazard_status" text DEFAULT 'NON_BAHAYA' NOT NULL,
        "chemical_inventory" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "major_hazard_doc_uploaded" boolean DEFAULT false NOT NULL,
        "ahli_k3_kimia_count" integer DEFAULT 0 NOT NULL,
        "petugas_k3_kimia_count" integer DEFAULT 0 NOT NULL,
        "last_chemical_inspection_date" timestamp with time zone,
        "next_emergency_drill_date" timestamp with time zone,
        "expiry_alert_days" integer DEFAULT 60 NOT NULL,
        "smk3_elements_map" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "project_members" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "project_role" text NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "work_nodes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "parent_id" uuid,
        "wbs_code" text NOT NULL,
        "name" text NOT NULL,
        "weight_percent" numeric(5, 2) DEFAULT '0.00' NOT NULL,
        "planned_start_date" timestamp with time zone,
        "planned_end_date" timestamp with time zone,
        "document_reference_no" text,
        "active_revision" text,
        "claimed_progress_percent" integer DEFAULT 0 NOT NULL,
        "verified_progress_percent" integer DEFAULT 0 NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "work_workflows" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "node_id" uuid NOT NULL REFERENCES "work_nodes"("id") ON DELETE CASCADE,
        "title" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "work_stages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workflow_id" uuid NOT NULL REFERENCES "work_workflows"("id") ON DELETE CASCADE,
        "stage_order" integer DEFAULT 1 NOT NULL,
        "stage_type" text DEFAULT 'work' NOT NULL,
        "name" text NOT NULL,
        "assigned_role" text NOT NULL,
        "approval_role" text,
        "checklist_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "requires_wet_signature" boolean DEFAULT false NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "actual_completed_at" timestamp with time zone,
        "forecast_completion_date" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "inspection_attempts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "stage_id" uuid NOT NULL REFERENCES "work_stages"("id") ON DELETE CASCADE,
        "attempt_number" integer DEFAULT 1 NOT NULL,
        "submitter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
        "approver_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "decided_at" timestamp with time zone,
        "status" text DEFAULT 'submitted' NOT NULL,
        "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "rejection_reason" text,
        "signature_canvas_url" text,
        "wet_signature_document_url" text,
        "offline_sync_id" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "evidence_attachments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "attempt_id" uuid REFERENCES "inspection_attempts"("id") ON DELETE CASCADE,
        "file_url" text NOT NULL,
        "attachment_type" text DEFAULT 'photo' NOT NULL,
        "sha256" text NOT NULL,
        "size_bytes" integer,
        "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
        "uploader_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "punchlist_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "node_id" uuid NOT NULL REFERENCES "work_nodes"("id") ON DELETE CASCADE,
        "stage_id" uuid NOT NULL REFERENCES "work_stages"("id") ON DELETE CASCADE,
        "attempt_id" uuid REFERENCES "inspection_attempts"("id") ON DELETE SET NULL,
        "issue_description" text NOT NULL,
        "severity" text DEFAULT 'medium' NOT NULL,
        "creator_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "assignee_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "status" text DEFAULT 'open' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "planned_curve_overrides" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "week_index" integer NOT NULL,
        "planned_cumulative_percent" numeric(5, 2) NOT NULL,
        "justification" text NOT NULL,
        "overridden_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "daily_weather_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "log_date" date NOT NULL,
        "rain_hours" numeric(4, 2) DEFAULT '0.00' NOT NULL,
        "weather_condition" text DEFAULT 'Clear' NOT NULL,
        "is_work_halted" boolean DEFAULT false NOT NULL,
        "impact_notes" text,
        "recorded_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `;

    await client.query(DDL);
  }

  await client.end();
}
