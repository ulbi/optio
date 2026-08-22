-- Add opencode LiteLLM models configuration to repos table
ALTER TABLE "repos" ADD COLUMN "opencode_litellm_models" jsonb;