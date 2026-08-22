# Plan: "ask optio" LiteLLM Proxy Support

## Ziel
Ermöglichen, dass **alle interaktiven Wege** ("ask optio") — Session Chat, Persistent Agents, PR Review Chat — **über einen LiteLLM Proxy** laufen, der beliebige Models dahinter hat (nicht nur Anthropic).

---

## Betroffene Interaktionswege ("ask optio")

| Weg | Entry Point | Aktueller Status | Ziel |
|-----|-------------|------------------|------|
| **Session Chat** | `apps/api/src/ws/session-chat.ts` | Hardcoded `claude` CLI + `ANTHROPIC_API_KEY` | LiteLLM Proxy Support |
| **Persistent Agents** | `apps/api/src/workers/persistent-agent-worker.ts` | Nutzt `claude-code`, `opencode`, `codex`, etc. direkt | LiteLLM als Option für alle Runtimes |
| **PR Review Chat** | `apps/api/src/ws/pr-review-worker.ts` | Hardcoded `claude` CLI | LiteLLM Proxy Support |

---

## Architektur-Entscheidung: **Variante B (Hybrid - Empfehlung)**
Wir nutzen die bestehende OpenCode Integration als Universal-Client für den Session-Chat und die CLI-Adapter-Ebene für den Claude-Code/Persistent Agent-Worker.

### 1. DB Schema Erweiterungen (`apps/api/src/db/schema.ts`)
Wir erweitern die Tabellen für Einstellungen, Repositories und Persistent Agents um die LiteLLM Proxy Konfiguration:

```typescript
// 1. Optio-Einstellungen (Workspace / Global)
export const optioSettings = pgTable("optio_settings", {
  // ... existing fields ...
  litellmProxyUrl: text("litellm_proxy_url"),
  litellmApiKeySecret: text("litellm_api_key_secret"),
  litellmDefaultModel: text("litellm_default_model"),
});

// 2. Persistent Agents Table
export const persistentAgents = pgTable("persistent_agents", {
  // ... existing fields ...
  litellmProxyUrl: text("litellm_proxy_url"),
  litellmApiKeySecret: text("litellm_api_key_secret"),
  litellmModel: text("litellm_model"),
});
```

### 2. Config Resolution (`packages/shared/src/utils/litellm-chat-config.ts` [NEU])
Erstellung eines Shared Utility Service, um die LiteLLM Konfiguration hierarchisch aufzulösen:

```typescript
export interface LiteLLMChatConfig {
  proxyUrl: string;
  apiKeySecret: string;
  model: string;
}

export async function resolveLiteLLMChatConfig(
  workspaceId?: string | null,
  sessionId?: string,
  agentId?: string
): Promise<LiteLLMChatConfig | null> {
  // Priority: Agent -> Session -> Workspace -> Global
  // Holt URL, Secret-Name und Model aus den DB-Einträgen
}
```

### 3. Session Chat (`apps/api/src/ws/session-chat.ts`)
Wir ersetzen den Aufruf der hardcodeten `claude` CLI durch den flexiblen **OpenCode Universal Client**, wenn ein LiteLLM Proxy konfiguriert ist:

```typescript
const litellm = await resolveLiteLLMChatConfig(workspaceId, sessionId);

if (litellm) {
  // Nutze opencode mit OpenAI-kompatibler Route von LiteLLM
  env.OPENAI_BASE_URL = `${litellm.proxyUrl}/v1`;
  env.OPENAI_API_KEY = await retrieveSecret(litellm.apiKeySecret);
  
  const modelFlag = litellm.model ? ` --model ${JSON.stringify(litellm.model)}` : "";
  script = `opencode run --format json${modelFlag} "${escapedPrompt}"`;
} else {
  // Fallback auf klassisches Claude CLI
  // ... existing code ...
}
```

### 4. Persistent Agent Worker (`apps/api/src/workers/persistent-agent-worker.ts`)
Anpassung von `buildAgentCommand` für die `claude-code` Runtime, um LiteLLM als Anthropic-kompatiblen Proxy anzusprechen:

```typescript
case "claude-code": {
  if (env.OPTIO_LITELLM_PROXY_URL) {
    // LiteLLM im Anthropic-Kompatibilitätsmodus nutzen
    env.ANTHROPIC_BASE_URL = `${env.OPTIO_LITELLM_PROXY_URL}/anthropic`;
    env.ANTHROPIC_API_KEY = env.OPTIO_LITELLM_API_KEY;
  }
  // ... rest of command assembly ...
}
```

### 5. Web UI Änderungen
- **Einstellungen**: Neuer Bereich "LiteLLM Proxy" mit Eingabemöglichkeit für URL, API Key Secret und Standard-Model.
- **Agenten Erstellung**: Dropdown zur Auswahl des Modells (ausgelesen über den LiteLLM Proxy `/models` Endpoint).
