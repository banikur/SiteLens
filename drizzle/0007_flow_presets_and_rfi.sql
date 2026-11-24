CREATE TABLE IF NOT EXISTS "flow_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_organization_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "flow_preset_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"step_type" text NOT NULL,
	"name" text NOT NULL,
	"required_permission" text,
	"can_combine_with_next" boolean DEFAULT false NOT NULL,
	"requires_signature" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_preset_steps_preset_id_flow_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."flow_presets"("id") ON DELETE cascade ON UPDATE no action
);

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "flow_preset_id" uuid;
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_flow_preset_id_flow_presets_id_fk" FOREIGN KEY ("flow_preset_id") REFERENCES "public"."flow_presets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "inspection_attempts" ADD COLUMN IF NOT EXISTS "requester_id" uuid;
DO $$ BEGIN
 ALTER TABLE "inspection_attempts" ADD CONSTRAINT "inspection_attempts_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "inspection_attempts" ADD COLUMN IF NOT EXISTS "requested_at" timestamp with time zone;
