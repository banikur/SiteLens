CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"version" text DEFAULT '1.0' NOT NULL,
	"standard_body" text DEFAULT 'Custom' NOT NULL,
	"standard_code" text,
	"document_control_no" text,
	"project_id" text,
	"target_role" text,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"approval_role" text,
	"workflow_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_minutes" integer DEFAULT 20 NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_master_template" boolean DEFAULT false NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"author_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrective_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"inspection_id" text NOT NULL,
	"inspection_title" text NOT NULL,
	"project_id" text NOT NULL,
	"project_name" text NOT NULL,
	"site_zone" text NOT NULL,
	"field_label" text NOT NULL,
	"issue_description" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"assigned_to_name" text NOT NULL,
	"assigned_to_role" text NOT NULL,
	"due_date" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"evidence_photo_url" text
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" text PRIMARY KEY NOT NULL,
	"client_mutation_id" text,
	"template_id" text NOT NULL,
	"template_title" text NOT NULL,
	"category" text NOT NULL,
	"project_id" text NOT NULL,
	"project_name" text NOT NULL,
	"site_zone" text NOT NULL,
	"inspector_id" text NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspections_client_mutation_id_unique" UNIQUE("client_mutation_id")
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"smtp_host" text,
	"smtp_port" integer DEFAULT 587,
	"smtp_user" text,
	"smtp_pass" text,
	"smtp_from" text,
	"webhook_url" text,
	"webhook_type" text DEFAULT 'generic',
	"notify_on_critical_capa" boolean DEFAULT true NOT NULL,
	"notify_on_approval" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"client" text NOT NULL,
	"location" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lead_manager" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"pin_hash" text,
	"role" text NOT NULL,
	"title" text NOT NULL,
	"avatar" text DEFAULT '' NOT NULL,
	"assigned_projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_name" text DEFAULT 'Registered Device' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;