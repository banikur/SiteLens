ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "sites" jsonb DEFAULT '[]'::jsonb NOT NULL;
