CREATE TABLE "tenant_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text DEFAULT 'SiteLens Enterprise Facilities' NOT NULL,
	"facility_location" text DEFAULT 'Balikpapan Process Terminal Sector 4' NOT NULL,
	"workforce_count" integer DEFAULT 150 NOT NULL,
	"risk_level" text DEFAULT 'HIGH' NOT NULL,
	"target_smk3_level" text DEFAULT 'LANJUTAN_166' NOT NULL,
	"chemical_hazard_status" text DEFAULT 'POTENSI_BAHAYA_MENENGAH' NOT NULL,
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
