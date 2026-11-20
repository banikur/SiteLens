CREATE TABLE "daily_weather_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"log_date" timestamp with time zone NOT NULL,
	"weather_condition" text DEFAULT 'cerah' NOT NULL,
	"rain_hours" numeric(4, 2) DEFAULT '0.00' NOT NULL,
	"work_impact" text DEFAULT 'tidak_ada' NOT NULL,
	"notes" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_weather_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "daily_weather_logs" ADD CONSTRAINT "daily_weather_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "daily_weather_logs" ADD CONSTRAINT "daily_weather_logs_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
