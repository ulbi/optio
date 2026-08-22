# Plan: Claude Code LiteLLM Proxy Support in Optio

This document outlines the proposed changes to enable complete configuration of Claude Code via a LiteLLM Proxy in Optio.

## Objectives

- Integrate custom LiteLLM Proxy config into Claude Code adapter and repo settings.
- Use `ANTHROPIC_BASE_URL` environment variable (Claude Code respects this for custom endpoints).
- Re-use the existing `ANTHROPIC_API_KEY` secret for the LiteLLM apiKey (simplifies secret handling).
- Allow repo-level override of base URL for LiteLLM Proxy.

---

## 1. DB Schema Updates (`apps/api/src/db/schema.ts`)

Add one text column `claudeCodeBaseUrl` to the `repos` table.

```typescript
// apps/api/src/db/schema.ts
export const repos = pgTable("repos", {
  // ... existing fields ...
  claudeCodeBaseUrl: text("claude_code_base_url"), // Custom Anthropic-compatible endpoint URL (e.g. http://litellm:4000/v1)
  // ...
});
```

---

## 2. API Routes & Repository Services

### API Routes (`apps/api/src/routes/repos.ts`)

Add the field to `updateRepoSchema`:

```typescript
// apps/api/src/routes/repos.ts
const updateRepoSchema = z.object({
  // ... existing fields ...
  claudeCodeBaseUrl: z.string().url().nullable().optional(),
  // ...
});
```

### Repo Service (`apps/api/src/services/repo-service.ts`)

Update `RepoRecord` and type mapping interfaces to support `claudeCodeBaseUrl`.

---

## 3. Shared Types (`packages/shared/src/types/agent.ts`)

Add `claudeCodeBaseUrl` to `AgentTaskInput` so the task worker can supply it to the adapter.

```typescript
// packages/shared/src/types/agent.ts
export interface AgentTaskInput {
  // ... existing fields ...
  claudeCodeBaseUrl?: string;
}
```

---

## 4. Provider Catalog (`packages/shared/src/agent-options/anthropic.ts`)

Add a new option field for the LiteLLM Proxy base URL in the catalog.

```typescript
// packages/shared/src/agent-options/anthropic.ts
export const ANTHROPIC_CATALOG: ProviderCatalog = {
  // ... existing fields ...
  options: [
    // ... existing options ...
    {
      key: "claudeCodeBaseUrl",
      label: "LiteLLM Proxy Base URL",
      kind: "text",
      placeholder: "http://litellm:4000/v1",
      helpText: "Custom Anthropic-compatible endpoint (e.g., LiteLLM Proxy). When set, uses ANTHROPIC_API_KEY as the proxy key.",
    },
  ],
};
```

---

## 5. Claude Code Adapter (`packages/agent-adapters/src/claude-code.ts`)

If `claudeCodeBaseUrl` is present, set `ANTHROPIC_BASE_URL` in the container env.

```typescript
// packages/agent-adapters/src/claude-code.ts
buildContainerConfig(input: AgentTaskInput): AgentContainerConfig {
  // ... existing code ...
  
  // Custom Anthropic-compatible endpoint (e.g., LiteLLM Proxy)
  if (input.claudeCodeBaseUrl) {
    env.ANTHROPIC_BASE_URL = input.claudeCodeBaseUrl;
    // ANTHROPIC_API_KEY is already required via requiredSecrets in validateSecrets
    // and will be injected from secrets store
  }
  
  // ... rest of existing code ...
}
```

---

## 6. Task Worker (`apps/api/src/workers/task-worker.ts`)

Pass `claudeCodeBaseUrl` from the repository record to the container builder.

```typescript
// apps/api/src/workers/task-worker.ts
const agentConfig = adapter.buildContainerConfig({
  // ... existing fields ...
  claudeCodeBaseUrl: repoConfig?.claudeCodeBaseUrl ?? undefined,
});
```

---

## 7. Workflow Worker (`apps/api/src/workers/workflow-worker.ts`)

The workflow worker uses the same adapter, so it will automatically benefit from the change. No additional changes needed.

---

## 8. Verification & Tests

### Unit Tests (`packages/agent-adapters/src/claude-code.test.ts`)

Add unit tests that cover:
- Checking if `ANTHROPIC_BASE_URL` is correctly set in container env when `claudeCodeBaseUrl` is supplied.
- Checking that `ANTHROPIC_API_KEY` is still required in `requiredSecrets`.
- Checking that the adapter works correctly without the base URL (backwards compatibility).

### Integration Test

- Create a test that provisions a task with a LiteLLM Proxy URL and verifies the agent can connect through it.

---

## Migration Notes

- Generate migration with `cd apps/api && npx drizzle-kit generate`
- Run migration with `cd apps/api && npx tsx src/db/migrate.ts`
- The column is nullable, so existing repos will have `NULL` and work as before.

---

## Variant: Per-Agent Model Mapping (Advanced)

If more granular control is needed (different models for plan/review/code), extend the schema similarly to the OpenCode plan:

```typescript
// Additional JSONB column for agent-specific model mappings
claudeCodeLiteLLMModels: jsonb("claude_code_litellm_models").$type<{
  plan?: string;
  review?: string;
  code?: string;
}>(),
```

This would require updating the adapter to write a custom `.claude/settings.json` or pass model flags dynamically.