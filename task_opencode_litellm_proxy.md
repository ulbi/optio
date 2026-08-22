# Plan: OpenCode LiteLLM Proxy Support in Optio

This document outlines the proposed changes to enable complete configuration of OpenCode via a LiteLLM Proxy in Optio.

## Objectives

- Integrate custom LiteLLM Proxy config into OpenCode adapter and repo settings.
- Avoid 7+ redundant columns in the DB by using a single JSON column for agent-to-model mappings.
- Re-use the existing `opencode_base_url` for the LiteLLM baseURL.
- Re-use the existing `OPENAI_API_KEY` secret for the LiteLLM apiKey (simplifies secret handling).
- Dynamically write the full `opencode.json` config inside the agent container.

---

## 1. DB Schema Updates (`apps/api/src/db/schema.ts`)

Add one JSONB column `opencode_litellm_models` to the `repos` table.

```typescript
// apps/api/src/db/schema.ts
export const repos = pgTable("repos", {
  // ... existing fields ...
  opencodeLiteLLMModels: jsonb("opencode_litellm_models").$type<{
    plan?: string;
    review?: string;
    code?: string;
    chat?: string;
    quick?: string;
    lint?: string;
    small?: string;
  }>(),
  // ...
});
```

---

## 2. API Routes & Repository Services

### API Routes (`apps/api/src/routes/repos.ts`)

Add the JSON schema for `opencodeLiteLLMModels` to `updateRepoSchema`:

```typescript
// apps/api/src/routes/repos.ts
const updateRepoSchema = z.object({
  // ... existing fields ...
  opencodeLiteLLMModels: z
    .object({
      plan: z.string().optional(),
      review: z.string().optional(),
      code: z.string().optional(),
      chat: z.string().optional(),
      quick: z.string().optional(),
      lint: z.string().optional(),
      small: z.string().optional(),
    })
    .nullable()
    .optional(),
  // ...
});
```

### Repo Service (`apps/api/src/services/repo-service.ts`)

Update `RepoRecord` and type mapping interfaces to support `opencodeLiteLLMModels`.

---

## 3. Shared Types (`packages/shared/src/types/agent.ts`)

Add `opencodeLiteLLMModels` to `AgentTaskInput` so the task worker can supply it to the adapter.

```typescript
// packages/shared/src/types/agent.ts
export interface AgentTaskInput {
  // ... existing fields ...
  opencodeLiteLLMModels?: {
    plan?: string;
    review?: string;
    code?: string;
    chat?: string;
    quick?: string;
    lint?: string;
    small?: string;
  };
}
```

---

## 4. OpenCode Adapter (`packages/agent-adapters/src/opencode.ts`)

If `opencodeBaseUrl` and `opencodeLiteLLMModels` are both present, dynamically construct and seed the complete `opencode.json` in the container setup files.

### Configuration Template logic:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "<opencodeLiteLLMModels.chat>",
  "small_model": "<opencodeLiteLLMModels.small>",
  "provider": {
    "litellm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LiteLLM Proxy",
      "options": {
        "baseURL": "<opencodeBaseUrl>",
        "apiKey": "{env:OPENAI_API_KEY}"
      },
      "models": {
        // Map all unique configured model names here:
        "<model>": { "name": "LiteLLM Model Name" }
      }
    }
  },
  "agent": {
    "build": {
      "model": "litellm/<opencodeLiteLLMModels.code>",
      "description": "Default implementation agent"
    },
    "plan": {
      "model": "litellm/<opencodeLiteLLMModels.plan>",
      "description": "Planning agent",
      "permission": { "edit": "deny", "bash": "deny" }
    },
    "review": {
      "mode": "subagent",
      "model": "litellm/<opencodeLiteLLMModels.review>",
      "description": "Code review",
      "permission": { "edit": "deny", "bash": "deny" }
    },
    "lint": {
      "mode": "subagent",
      "model": "litellm/<opencodeLiteLLMModels.lint>",
      "description": "Linting & fixes",
      "permission": { "edit": "allow", "bash": "allow" }
    },
    "quick": {
      "mode": "subagent",
      "model": "litellm/<opencodeLiteLLMModels.quick>",
      "description": "Fast responses",
      "steps": 5
    }
  }
}
```

### Key Resolver Secrets logic:

Ensure `OPENAI_API_KEY` is added to `requiredSecrets` when LiteLLM config is generated.

---

## 5. Task Worker (`apps/api/src/workers/task-worker.ts`)

Pass `opencodeLiteLLMModels` from the repository record to the container builder.

```typescript
// apps/api/src/workers/task-worker.ts
const agentConfig = adapter.buildContainerConfig({
  // ... existing fields ...
  opencodeLiteLLMModels: repoConfig?.opencodeLiteLLMModels ?? undefined,
});
```

---

## 6. Verification & Tests (`packages/agent-adapters/src/opencode.test.ts`)

Add unit tests that cover:

- Checking if a complete `opencode.json` is correctly written to `/home/agent/.config/opencode/opencode.json` when `opencodeBaseUrl` and `opencodeLiteLLMModels` are supplied.
- Checking if the template includes the correct model mappings and settings.
- Checking if `OPENAI_API_KEY` is required.
