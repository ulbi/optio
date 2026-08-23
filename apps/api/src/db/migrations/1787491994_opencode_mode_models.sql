-- Add opencode mode models configuration to repos table
ALTER TABLE "repos" ADD COLUMN "opencode_mode_models" jsonb;