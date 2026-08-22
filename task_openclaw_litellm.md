# Plan: OpenClaw LiteLLM Proxy Support in Optio

This document outlines the proposed changes to enable complete configuration of OpenClaw via a LiteLLM Proxy in Optio.

## Objectives

- Integrate custom LiteLLM Proxy config into OpenClaw adapter and repo settings.
- OpenClaw is similar to OpenCode - it's a provider-agnostic wrapper that uses downstream providers (Anthropic, OpenAI, etc.)
- Use `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` environment variables depending on the provider being used.
- Re-use the existing `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` secrets for the LiteLLM apiKey.
- Follow the same pattern as OpenCode since both are provider-agnostic wrappers.

---

## 1. DB Schema Updates (`apps/api/src/db/schema.ts`)

Add one text column `openclawBaseUrl` to the `repos` table.

```typescript
// apps/api/src/db/schema.ts
export const repos = pgTable("repos", {
  // ... existing fields ...
  openclawBaseUrl: text("openclaw_base_url"), // Custom OpenAI/Anthropic-compatible endpoint URL (e.g. http://litellm:4000/v1)
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
  openclawBaseUrl: z.string().url().nullable().optional(),
  // ...
});
```

### Repo Service (`apps/api/src/services/repo-service.ts`)

Update `RepoRecord` and type mapping interfaces to support `openclawBaseUrl`.

---

## 3. Shared Types (`packages/shared/src/types/agent.ts`)

Add `openclawBaseUrl` to `AgentTaskInput` so the task worker can supply it to the adapter.

```typescript
// packages/shared/src/types/agent.ts
export interface AgentTaskInput {
  // ... existing fields ...
  openclawBaseUrl?: string;
}
```

---

## 4. Provider Catalog (`packages/shared/src/agent-options/openclaw.ts`)

Add a new option field for the LiteLLM Proxy base URL in the catalog.

```typescript
// packages/shared/src/agent-options/openclaw.ts
export const OPENCLAW_CATALOG: ProviderCatalog = {
  // ... existing fields ...
  options: [
    // ... existing options ...
    {
      key: "openclawBaseUrl",
      label: "LiteLLM Proxy Base URL",
      kind: "text",
      placeholder: "http://litellm:4000/v1",
      helpText: "Custom OpenAI/Anthropic-compatible endpoint (e.g., LiteLLM Proxy). When set, uses the corresponding provider API key (OPENAI_API_KEY or ANTHROPIC_API_KEY) as the proxy key. The model string (e.g., 'openai/gpt-4o') determines which provider/base URL is used.",
    },
  ],
};
```

---

## 5. OpenClaw Adapter (`packages/agent-adapters/src/openclaw.ts`)

If `openclawBaseUrl` is present, set the appropriate base URL env vars in the container env. Since OpenClaw is provider-agnostic and the model string determines the provider (e.g., `openai/gpt-4o` vs `anthropic/claude-sonnet-4`), we should set both base URLs to the same LiteLLM endpoint.

```typescript
// packages/agent-adapters/src/openclaw.ts
buildContainerConfig(input: AgentTaskInput): AgentContainerConfig {
  // ... existing code ...
  
  // Custom OpenAI/Anthropic-compatible endpoint (e.g., LiteLLM Proxy)
  // OpenClaw uses the model prefix to determine provider (openai/*, anthropic/*)
  // So we set both base URLs to the LiteLLM endpoint
  if (input.openclawBaseUrl) {
    env.OPENAI_BASE_URL = input.openclawBaseUrl;
    env.ANTHROPIC_BASE_URL = input.openclawBaseUrl;
    // Also set a generic one for any other providers
    env.LITELLM_BASE_URL = input.openclawBaseUrl;
  }
  
  // When using custom base URL, provider API keys are optional
  // The adapter sets a placeholder that gets overridden if a real secret exists
  if (input.openclawBaseUrl) {
    // Only require keys if NOT using custom base URL
    // With LiteLLM, a single key (or placeholder) may suffice
    // We still add them to requiredSecrets so they get injected if available
    // But we also inject placeholders like OpenCode does
    env.OPENAI_API_KEY = "sk-no-key-required";
    env.ANTHROPIC_API_KEY = "sk-no-key-required";
  }
  
  // ... rest of existing code ...
}
```

**Note:** The existing `validateSecrets` requires at least one provider key. With LiteLLM Proxy, we should modify this:

```typescript
validateSecrets(availableSecrets: string[]): { valid: boolean; missing: string[] } {
  // OpenClaw is provider-agnostic — it needs at least one provider API key
  // UNLESS a custom base URL (LiteLLM) is configured
  const acceptedKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENCLAW_API_KEY"];
  const hasAny = acceptedKeys.some((k) => availableSecrets.includes(k));
  
  // If base URL is configured, keys are optional (LiteLLM handles auth)
  // This would need to be passed in, so we may need to adjust the interface
  // For now, keep existing behavior - user must provide at least one key
  return {
    valid: hasAny,
    missing: hasAny ? [] : ["ANTHROPIC_API_KEY or OPENAI_API_KEY or OPENCLAW_API_KEY"],
  };
}
```

Actually, the `validateSecrets` doesn't have access to the input config. We may need to adjust the adapter interface or handle this in the task worker. For simplicity, we'll keep the validation as-is and just inject placeholders when base URL is set (the secrets will override if they exist).

---

## 6. Task Worker (`apps/api/src/workers/task-worker.ts`)

Pass `openclawBaseUrl` from the repository record to the container builder.

```typescript
// apps/api/src/workers/task-worker.ts
const agentConfig = adapter.buildContainerConfig({
  // ... existing fields ...
  openclawBaseUrl: repoConfig?.openclawBaseUrl ?? undefined,
});
```

Also fetch from secrets if there's a global default:

```typescript
// In task-worker.ts where other defaults are fetched
const openclawDefaultBaseUrl =
  ((await retrieveSecretWithFallback(
    "OPENCLAW_DEFAULT_BASE_URL",
    "global",
    taskWorkspaceId,
  ).catch(() => null)) as any) ?? undefined;
```

And pass it as fallback:
```typescript
openclawBaseUrl: repoConfig?.openclawBaseUrl ?? openclawDefaultBaseUrl,
```

---

## 7. Workflow Worker (`apps/api/src/workers/workflow-worker.ts`)

The workflow worker uses the same adapter, so it will automatically benefit from the change.

---

## 8. Verification & Tests

### Unit Tests (`packages/agent-adapters/src/openclaw.test.ts`)

Add unit tests that cover:
- Checking if `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` are correctly set in container env when `openclawBaseUrl` is supplied.
- Checking that placeholder keys are injected when base URL is set.
- Checking that real secrets override placeholders when available.
- Backwards compatibility without base URL.

### Integration Test

- Create a test that provisions a task with a LiteLLM Proxy URL and verifies the agent can connect through it with both `openai/*` and `anthropic/*` models.

---

## Migration Notes

- Generate migration with `cd apps/api && npx drizzle-kit generate`
- Run migration with `cd apps/api && npx tsx src/db/migrate.ts`
- The column is nullable, so existing repos will have `NULL` and work as before.

---

## Variant: Per-Provider Base URLs (Advanced)

If different providers need different LiteLLM endpoints, add separate columns:

```typescript
openclawOpenAIBaseUrl: text("openclaw_openai_base_url"),
openclawAnthropicBaseUrl: text("openclaw_anthropic_base_url"),
```

And in the adapter:
```typescript
if (input.openclawOpenAIBaseUrl) env.OPENAI_BASE_URL = input.openclawOpenAIBaseUrl;
if (input.openclawAnthropicBaseUrl) env.ANTHROPIC_BASE_URL = input.openclawAnthropicBaseUrl;
```

This is only needed if routing different providers to different LiteLLM instances.