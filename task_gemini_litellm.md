# Plan: Google Gemini LiteLLM Proxy Support in Optio

This document outlines the proposed changes to enable complete configuration of Google Gemini via a LiteLLM Proxy in Optio.

## Objectives

- Integrate custom LiteLLM Proxy config into Gemini adapter and repo settings.
- Use `GOOGLE_API_BASE_URL` or `GEMINI_BASE_URL` environment variable (Gemini CLI respects this for custom endpoints).
- Re-use the existing `GEMINI_API_KEY` / `GOOGLE_API_KEY` secret for the LiteLLM apiKey.
- Work alongside the existing `geminiAuthMode: "vertex-ai"` mode.

---

## 1. DB Schema Updates (`apps/api/src/db/schema.ts`)

Add one text column `geminiBaseUrl` to the `repos` table.

```typescript
// apps/api/src/db/schema.ts
export const repos = pgTable("repos", {
  // ... existing fields ...
  geminiBaseUrl: text("gemini_base_url"), // Custom Google AI-compatible endpoint URL (e.g. http://litellm:4000/v1)
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
  geminiBaseUrl: z.string().url().nullable().optional(),
  // ...
});
```

### Repo Service (`apps/api/src/services/repo-service.ts`)

Update `RepoRecord` and type mapping interfaces to support `geminiBaseUrl`.

---

## 3. Shared Types (`packages/shared/src/types/agent.ts`)

Add `geminiBaseUrl` to `AgentTaskInput` so the task worker can supply it to the adapter.

```typescript
// packages/shared/src/types/agent.ts
export interface AgentTaskInput {
  // ... existing fields ...
  geminiBaseUrl?: string;
}
```

---

## 4. Provider Catalog (`packages/shared/src/agent-options/gemini.ts`)

Add a new option field for the LiteLLM Proxy base URL in the catalog.

```typescript
// packages/shared/src/agent-options/gemini.ts
export const GEMINI_CATALOG: ProviderCatalog = {
  // ... existing fields ...
  options: [
    // ... existing options ...
    {
      key: "geminiBaseUrl",
      label: "LiteLLM Proxy Base URL",
      kind: "text",
      placeholder: "http://litellm:4000/v1",
      helpText: "Custom Google AI-compatible endpoint (e.g., LiteLLM Proxy). When set, uses GEMINI_API_KEY as the proxy key. Ignored when using Vertex AI auth mode.",
    },
  ],
};
```

---

## 5. Gemini Adapter (`packages/agent-adapters/src/gemini.ts`)

If `geminiBaseUrl` is present and auth mode is `api-key`, set the appropriate base URL env var in the container env.

```typescript
// packages/agent-adapters/src/gemini.ts
buildContainerConfig(input: AgentTaskInput): AgentContainerConfig {
  // ... existing code ...
  
  if (input.geminiAuthMode === "vertex-ai") {
    env.OPTIO_GEMINI_AUTH_MODE = "vertex-ai";
    env.GOOGLE_GENAI_USE_VERTEXAI = "true";
    if (input.googleCloudProject) {
      env.GOOGLE_CLOUD_PROJECT = input.googleCloudProject;
    }
    if (input.googleCloudLocation) {
      env.GOOGLE_CLOUD_LOCATION = input.googleCloudLocation;
    }
  } else {
    env.OPTIO_GEMINI_AUTH_MODE = "api-key";
    requiredSecrets.push("GEMINI_API_KEY");
    
    // Custom Google AI-compatible endpoint (e.g., LiteLLM Proxy)
    // Gemini CLI uses GOOGLE_API_BASE_URL or GEMINI_BASE_URL
    if (input.geminiBaseUrl) {
      env.GOOGLE_API_BASE_URL = input.geminiBaseUrl;
      // Also set GEMINI_BASE_URL for compatibility
      env.GEMINI_BASE_URL = input.geminiBaseUrl;
    }
  }
  
  // ... rest of existing code ...
}
```

---

## 6. Task Worker (`apps/api/src/workers/task-worker.ts`)

Pass `geminiBaseUrl` from the repository record to the container builder.

```typescript
// apps/api/src/workers/task-worker.ts
const agentConfig = adapter.buildContainerConfig({
  // ... existing fields ...
  geminiBaseUrl: repoConfig?.geminiBaseUrl ?? undefined,
});
```

Also fetch from secrets if there's a global default:

```typescript
// In task-worker.ts where other defaults are fetched
const geminiDefaultBaseUrl =
  ((await retrieveSecretWithFallback(
    "GEMINI_DEFAULT_BASE_URL",
    "global",
    taskWorkspaceId,
  ).catch(() => null)) as any) ?? undefined;
```

And pass it as fallback:
```typescript
geminiBaseUrl: repoConfig?.geminiBaseUrl ?? geminiDefaultBaseUrl,
```

---

## 7. Workflow Worker (`apps/api/src/workers/workflow-worker.ts`)

The workflow worker uses the same adapter, so it will automatically benefit from the change. The `buildWorkflowAgentCommand` function uses the env vars set by the adapter.

---

## 8. Verification & Tests

### Unit Tests (`packages/agent-adapters/src/gemini.test.ts`)

Add unit tests that cover:
- Checking if `GOOGLE_API_BASE_URL` / `GEMINI_BASE_URL` is correctly set in container env when `geminiBaseUrl` is supplied and auth mode is `api-key`.
- Checking that base URL is NOT set when using `vertex-ai` auth mode.
- Checking that `GEMINI_API_KEY` is still required in `requiredSecrets` for api-key mode.
- Backwards compatibility without base URL.

### Integration Test

- Create a test that provisions a task with a LiteLLM Proxy URL and verifies the agent can connect through it.

---

## Migration Notes

- Generate migration with `cd apps/api && npx drizzle-kit generate`
- Run migration with `cd apps/api && npx tsx src/db/migrate.ts`
- The column is nullable, so existing repos will have `NULL` and work as before.

---

## Variant: Using LiteLLM with Vertex AI

If users want to use LiteLLM with Google Cloud Vertex AI models:
1. Configure LiteLLM to proxy to Vertex AI (using service account)
2. Use `geminiAuthMode: "api-key"` with `geminiBaseUrl` pointing to LiteLLM
3. This bypasses the need for Workload Identity / ADC in the agent pods

---

## Note on Environment Variables

The Gemini CLI (as of 2024/2025) respects:
- `GOOGLE_API_BASE_URL` - Primary variable for custom endpoints
- `GEMINI_BASE_URL` - Alternative, some versions may use this

Setting both ensures maximum compatibility. The adapter sets both to the same value.