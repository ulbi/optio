# Plan: OpenAI Codex LiteLLM Proxy Support in Optio

This document outlines the proposed changes to enable complete configuration of OpenAI Codex via a LiteLLM Proxy in Optio.

## Objectives

- Integrate custom LiteLLM Proxy config into Codex adapter and repo settings.
- Use `OPENAI_BASE_URL` environment variable (Codex CLI respects this for custom endpoints).
- Re-use the existing `OPENAI_API_KEY` secret for the LiteLLM apiKey.
- Work alongside the existing `codexAuthMode: "app-server"` mode.

---

## 1. DB Schema Updates (`apps/api/src/db/schema.ts`)

Add one text column `codexBaseUrl` to the `repos` table.

```typescript
// apps/api/src/db/schema.ts
export const repos = pgTable("repos", {
  // ... existing fields ...
  codexBaseUrl: text("codex_base_url"), // Custom OpenAI-compatible endpoint URL (e.g. http://litellm:4000/v1)
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
  codexBaseUrl: z.string().url().nullable().optional(),
  // ...
});
```

### Repo Service (`apps/api/src/services/repo-service.ts`)

Update `RepoRecord` and type mapping interfaces to support `codexBaseUrl`.

---

## 3. Shared Types (`packages/shared/src/types/agent.ts`)

Add `codexBaseUrl` to `AgentTaskInput` so the task worker can supply it to the adapter.

```typescript
// packages/shared/src/types/agent.ts
export interface AgentTaskInput {
  // ... existing fields ...
  codexBaseUrl?: string;
}
```

---

## 4. Provider Catalog (`packages/shared/src/agent-options/openai.ts`)

Add a new option field for the LiteLLM Proxy base URL in the catalog.

```typescript
// packages/shared/src/agent-options/openai.ts
export const OPENAI_CATALOG: ProviderCatalog = {
  // ... existing fields ...
  options: [
    {
      key: "codexBaseUrl",
      label: "LiteLLM Proxy Base URL",
      kind: "text",
      placeholder: "http://litellm:4000/v1",
      helpText: "Custom OpenAI-compatible endpoint (e.g., LiteLLM Proxy). When set, uses OPENAI_API_KEY as the proxy key. Ignored when using app-server auth mode.",
    },
  ],
};
```

---

## 5. Codex Adapter (`packages/agent-adapters/src/codex.ts`)

If `codexBaseUrl` is present and auth mode is `api-key`, set `OPENAI_BASE_URL` in the container env.

```typescript
// packages/agent-adapters/src/codex.ts
buildContainerConfig(input: AgentTaskInput): AgentContainerConfig {
  // ... existing code ...
  
  if (input.codexAuthMode === "app-server") {
    env.OPTIO_CODEX_AUTH_MODE = "app-server";
    if (input.codexAppServerUrl) {
      env.OPTIO_CODEX_APP_SERVER_URL = input.codexAppServerUrl;
    }
  } else {
    env.OPTIO_CODEX_AUTH_MODE = "api-key";
    requiredSecrets.push("OPENAI_API_KEY");
    
    // Custom OpenAI-compatible endpoint (e.g., LiteLLM Proxy)
    if (input.codexBaseUrl) {
      env.OPENAI_BASE_URL = input.codexBaseUrl;
    }
  }
  
  // ... rest of existing code ...
}
```

---

## 6. Task Worker (`apps/api/src/workers/task-worker.ts`)

Pass `codexBaseUrl` from the repository record to the container builder.

```typescript
// apps/api/src/workers/task-worker.ts
const agentConfig = adapter.buildContainerConfig({
  // ... existing fields ...
  codexBaseUrl: repoConfig?.codexBaseUrl ?? undefined,
});
```

Also fetch from secrets if there's a global default:

```typescript
// In task-worker.ts where other defaults are fetched
const codexDefaultBaseUrl =
  ((await retrieveSecretWithFallback(
    "CODEX_DEFAULT_BASE_URL",
    "global",
    taskWorkspaceId,
  ).catch(() => null)) as any) ?? undefined;
```

And pass it as fallback:
```typescript
codexBaseUrl: repoConfig?.codexBaseUrl ?? codexDefaultBaseUrl,
```

---

## 7. Workflow Worker (`apps/api/src/workers/workflow-worker.ts`)

The workflow worker uses the same adapter, so it will automatically benefit from the change. The `buildWorkflowAgentCommand` function uses the env vars set by the adapter.

---

## 8. Verification & Tests

### Unit Tests (`packages/agent-adapters/src/codex.test.ts`)

Add unit tests that cover:
- Checking if `OPENAI_BASE_URL` is correctly set in container env when `codexBaseUrl` is supplied and auth mode is `api-key`.
- Checking that `OPENAI_BASE_URL` is NOT set when using `app-server` auth mode.
- Checking that `OPENAI_API_KEY` is still required in `requiredSecrets` for api-key mode.
- Backwards compatibility without base URL.

### Integration Test

- Create a test that provisions a task with a LiteLLM Proxy URL and verifies the agent can connect through it.

---

## Migration Notes

- Generate migration with `cd apps/api && npx drizzle-kit generate`
- Run migration with `cd apps/api && npx tsx src/db/migrate.ts`
- The column is nullable, so existing repos will have `NULL` and work as before.

---

## Variant: App-Server Mode with LiteLLM

The existing `codexAuthMode: "app-server"` with `codexAppServerUrl` already supports a custom endpoint architecture. If users want to use LiteLLM with the app-server pattern, they can point `codexAppServerUrl` to a LiteLLM instance that speaks the Codex app-server protocol. This plan focuses on the simpler `OPENAI_BASE_URL` approach for the standard `api-key` mode.