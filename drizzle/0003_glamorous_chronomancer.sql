CREATE TABLE "evidence_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid,
	"file_url" text NOT NULL,
	"attachment_type" text DEFAULT 'photo' NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploader_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "inspection_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"submitter_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approver_id" uuid,
	"decided_at" timestamp with time zone,
	"status" text DEFAULT 'submitted' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rejection_reason" text,
	"signature_canvas_url" text,
	"wet_signature_document_url" text,
	"offline_sync_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "planned_curve_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"week_index" integer NOT NULL,
	"override_planned_cumulative" numeric(5, 2) NOT NULL,
	"overridden_by" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned_curve_overrides" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "punchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"attempt_id" uuid,
	"issue_description" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"creator_id" uuid NOT NULL,
	"assignee_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"rectified_at" timestamp with time zone,
	"rectification_photo_url" text,
	"verified_closed_by" uuid,
	"verified_closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "punchlist_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "work_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
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
--> statement-breakpoint
ALTER TABLE "work_nodes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "work_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
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
--> statement-breakpoint
ALTER TABLE "work_stages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "work_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_workflows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence_attachments" ADD CONSTRAINT "evidence_attachments_attempt_id_inspection_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."inspection_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_attachments" ADD CONSTRAINT "evidence_attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_attempts" ADD CONSTRAINT "inspection_attempts_stage_id_work_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."work_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_attempts" ADD CONSTRAINT "inspection_attempts_submitter_id_users_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_attempts" ADD CONSTRAINT "inspection_attempts_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_curve_overrides" ADD CONSTRAINT "planned_curve_overrides_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_curve_overrides" ADD CONSTRAINT "planned_curve_overrides_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punchlist_items" ADD CONSTRAINT "punchlist_items_node_id_work_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."work_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punchlist_items" ADD CONSTRAINT "punchlist_items_stage_id_work_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."work_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punchlist_items" ADD CONSTRAINT "punchlist_items_attempt_id_inspection_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."inspection_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punchlist_items" ADD CONSTRAINT "punchlist_items_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punchlist_items" ADD CONSTRAINT "punchlist_items_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punchlist_items" ADD CONSTRAINT "punchlist_items_verified_closed_by_users_id_fk" FOREIGN KEY ("verified_closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_nodes" ADD CONSTRAINT "work_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_stages" ADD CONSTRAINT "work_stages_workflow_id_work_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."work_workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_workflows" ADD CONSTRAINT "work_workflows_node_id_work_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."work_nodes"("id") ON DELETE cascade ON UPDATE no action;