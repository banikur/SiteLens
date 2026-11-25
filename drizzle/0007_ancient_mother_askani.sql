CREATE TABLE "flow_preset_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"step_type" text NOT NULL,
	"name" text NOT NULL,
	"required_permission" text,
	"can_combine_with_next" boolean DEFAULT false NOT NULL,
	"requires_signature" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_organization_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"owner_client" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "punchlist_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "punchlist_items" CASCADE;--> statement-breakpoint
ALTER TABLE "corrective_actions" ALTER COLUMN "inspection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "corrective_actions" ALTER COLUMN "inspection_title" SET DEFAULT 'Direct Finding';--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD COLUMN "node_id" uuid;--> statement-breakpoint
ALTER TABLE "inspection_attempts" ADD COLUMN "requester_id" uuid;--> statement-breakpoint
ALTER TABLE "inspection_attempts" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "master_project_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sites" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "flow_preset_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "require_pm_approval_for_detailing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_nodes" ADD COLUMN "allow_detailing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_nodes" ADD COLUMN "detailing_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_nodes" ADD COLUMN "volume" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "work_nodes" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "flow_preset_steps" ADD CONSTRAINT "flow_preset_steps_preset_id_flow_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."flow_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_projects" ADD CONSTRAINT "master_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_node_id_work_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."work_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_attempts" ADD CONSTRAINT "inspection_attempts_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_master_project_id_master_projects_id_fk" FOREIGN KEY ("master_project_id") REFERENCES "public"."master_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_flow_preset_id_flow_presets_id_fk" FOREIGN KEY ("flow_preset_id") REFERENCES "public"."flow_presets"("id") ON DELETE set null ON UPDATE no action;