# Implementierungsplan: MCP-Server in opencode.json für den OpenCode-Agenten

## 1. Problemstellung

Optio verfügt über ein eigenes System zur Verwaltung und Injektion von MCP-Servern (entweder über die Tabelle `mcp_servers` oder über `connections` mit `mcpConfig`). Diese werden aktuell für alle Agenten standardmäßig in eine Datei `.mcp.json` im Projekt-Root (Worktree) injiziert.

Der **OpenCode-Agent** liest jedoch laut offizieller Dokumentation **nicht** `.mcp.json`. Er erwartet MCP-Server stattdessen im `mcp`-Objekt innerhalb seiner Standard-Konfigurationsdatei **`opencode.json`** (entweder global unter `~/.config/opencode/opencode.json` oder im Projekt-Root).

Aktuell schreibt der `OpenCodeAdapter` lediglich eine minimale Standard-Config ohne MCP-Server unter `~/.config/opencode/opencode.json`, um den First-Run-Setup zu umgehen.

---

## 2. Ziel

Wenn eine Task mit dem Agententyp `opencode` ausgeführt wird, sollen alle für die Task konfigurierten/autorisierten MCP-Server aus Optio ausgelesen, in das `opencode.json`-kompatible Format transformiert und in der Datei `/home/agent/.config/opencode/opencode.json` bereitgestellt werden.

---

## 3. Technische Details & Datenformate

### Optio MCP-Eintrag (in `.mcp.json`)

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sentry"],
      "env": {
        "SENTRY_AUTH_TOKEN": "secret-token"
      }
    }
  }
}
```

### Gewünschtes OpenCode-Format (in `opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sentry": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-sentry"],
      "environment": {
        "SENTRY_AUTH_TOKEN": "secret-token"
      }
    }
  }
}
```

#### Transformationsregeln:

- **`command`**: Array, bestehend aus `[optioServer.command, ...optioServer.args]`.
- **`type`**: Fix auf `"local"` (da Optio MCP-Server als lokale Prozesse startet).
- **`environment`**: Kopie von `optioServer.env` (falls vorhanden).

---

## 4. Schritt-für-Schritt Umsetzungsplan

### Schritt 4.1: Erweiterung des Typ-Interfaces `AgentTaskInput`

Die `AgentTaskInput`-Struktur muss um ein Feld erweitert werden, damit der Worker die aufgelösten MCP-Server an den Adapter übergeben kann.

- **Datei:** `packages/shared/src/types/agent.ts`
- **Änderung:** Hinzufügen von `mcpServers` (optional):
  ```typescript
  export interface AgentTaskInput {
    // ... bestehende Felder ...
    mcpServers?: Record<
      string,
      {
        command: string;
        args: string[];
        env?: Record<string, string>;
      }
    >;
  }
  ```

### Schritt 4.2: Anpassung des `task-worker.ts` & `pr-review-worker.ts`

Die Worker müssen beim Erstellen der `AgentTaskInput` die bereits aufgelösten MCP-Server (inklusive derer aus Connections) sammeln und an den Adapter übergeben.

- **Dateien:**
  - `apps/api/src/workers/task-worker.ts`
  - `apps/api/src/workers/pr-review-worker.ts` (für PR-Reviews mit OpenCode)
- **Änderung:**
  In der Methode, die den Agent-Adapter aufruft (z.B. `buildContainerConfig`), müssen die generierten MCP-Server-Einträge in `mcpServers` gemappt und an den Adapter übergeben werden.
  ```typescript
  const mcpServersForAdapter: Record<string, any> = {};
  // Aus mcpServers (mcp-server-service) befüllen
  // Aus resolvedConnections (connection-service) befüllen
  ```

### Schritt 4.3: Implementierung der Transformation im `OpenCodeAdapter`

Der Adapter liest die `mcpServers` aus dem Input und baut daraus das `opencode.json`.

- **Datei:** `packages/agent-adapters/src/opencode.ts`
- **Änderung:**
  1. Helper-Funktion implementieren:
     ```typescript
     function transformToOpenCodeMcp(optioMcp: any) {
       return {
         type: "local",
         command: [optioMcp.command, ...(optioMcp.args || [])],
         ...(optioMcp.env && Object.keys(optioMcp.env).length > 0
           ? { environment: optioMcp.env }
           : {}),
       };
     }
     ```
  2. In `buildContainerConfig`:

     ```typescript
     const opencodeConfig: any = {
       $schema: "https://opencode.ai/config.json",
     };

     if (input.mcpServers && Object.keys(input.mcpServers).length > 0) {
       opencodeConfig.mcp = {};
       for (const [name, server] of Object.entries(input.mcpServers)) {
         opencodeConfig.mcp[name] = transformToOpenCodeMcp(server);
       }
     }

     setupFiles.push({
       path: "/home/agent/.config/opencode/opencode.json",
       content: JSON.stringify(opencodeConfig, null, 2),
     });
     ```

### Schritt 4.4: Erstellung von Unit-Tests

Die Generierung der MCP-Server-Konfiguration in `opencode.json` muss über Unittests abgesichert werden.

- **Datei:** `packages/agent-adapters/src/opencode.test.ts`
- **Test-Szenarien:**
  - Generierung von `opencode.json` ohne MCP-Server (Abwärtskompatibilität).
  - Generierung von `opencode.json` mit einem oder mehreren MCP-Servern (inkl. Env-Vars und Argumenten).

---

## 5. Vorteile dieses Ansatzes

1. **Keine Änderungen am OpenCode-Core erforderlich:** Wir nutzen das standardmäßige Konfigurationsverhalten von OpenCode.
2. **Abwärtskompatibilität:** Für andere Agenten (wie Claude Code) bleibt die Injektion in `.mcp.json` unberührt.
3. **Plattformunabhängigkeit:** Die MCP-Server werden sauber über standardisierte Umgebungsvariablen und Pfade im Pod bereitgestellt.
