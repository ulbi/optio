# Security Issue: Klartext-Secrets in Agent-Setup-Files

**Status:** Aktuell (akzeptierter Workaround)
**Erstellt:** 2026-09-06
**Rückbau-Bedingung:** Sobald [`docs/plans/agent-daemon-pid1.md`](../plans/agent-daemon-pid1.md) in irgendeiner Form umgesetzt ist (PID 1 Agent Daemon mit Secret-Handoff an Child-Prozesse ohne Persistenz auf dem Volume) → diesen Workaround entfernen.

## Zusammenfassung

Der OpenCode-Adapter erzeugt die Agent-Konfiguration (`~/.config/opencode/opencode.json`) mit dem Platzhalter `{env:OPENAI_API_KEY}` in `provider.*.options.apiKey`. OpenCode selbst löst diese Referenz **nicht** auf (Upstream [anomalyco/opencode#27853](https://github.com/anomalyco/opencode/issues/27853), "closed as not planned"): die LLM-Anfrage wird ohne `Authorization`-Header gesendet, der Proxy antwortet `401 "No api key passed in"`, die Session bricht ab (`isRetryable: false`) und der Task läuft in den Stall-Detektor → `failed`.

Als Workaround rendert der API-Worker den **literalen Secret-Wert** in die Setup-File-Inhalte:

- `substituteSecretPlaceholders()` in `apps/api/src/services/secret-service.ts` (nach `resolveSecretsForTask()`)
- Aufgerufen in `apps/api/src/workers/task-worker.ts` und `apps/api/src/workers/pr-review-worker.ts`, **bevor** die Setup-Files base64 in `OPTIO_SETUP_FILES` kodiert werden (Reihenfolge ist kritisch: Substitution → Encoding → `allEnv`-Snapshot).

## Was dadurch wo im Klartext liegt

| Ort                                                                               | Inhalt                                                                                 | Persistenz                                                                       |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `OPTIO_SETUP_FILES` Pod-Env (exec-Umgebung des Agent-Starts)                      | base64-encodierte Setup-Files **inkl. Secret-Werten** (base64 ist trivial dekodierbar) | Lebensdauer des Agent-Prozesses                                                  |
| `~/.config/opencode/opencode.json` im Repo-Pod                                    | Literal `apiKey`                                                                       | **PVC des Repo-Pods** — überlebt den Task (Pod bleibt bis Idle-Cleanup bestehen) |
| Verschiedene weitere Setup-Files (MCP-Configs, Skills) mit `{env:...}`-Referenzen | sofern sie auf Secret-Werte matchen                                                    | wie oben                                                                         |

## Threat-Modell / Risikobewertung

- **Grenzen des Schadens:** Der Secret-Wert liegt ohnehin bereits als Exec-Env-Variable (`OPENAI_API_KEY`) im Agent-Prozess — ein Agent- Prozess kann seine eigene Umgebung auslesen. Der Mehr-Ist-Schaden ist die **Persistenz** (PVC-Datei über die Task-Laufzeit hinaus) und die Sichtbarkeit im Pod-Env/Pod-Spec (`kubectl describe`/`kubectl get sts -o yaml` zeigt base64-encodiert).
- **Realistische Vektoren:** beliebiger Prozess im Repo-Pod (z. B. installierte Tools, deponierte Malware, dritte Agenten im selben Pod via Worktree-Exec) kann `~/.config/opencode/opencode.json` lesen; Volume-Snapshots/Backups des PVC enthalten den Key.
- **Nicht neu eingeführt:** die Secrets lagen vorher (als env) bereits im Pod-Manager-Kontext; neu ist die **Datei-/Spec-Sichtbarkeit**.

## Betroffene Komponenten

| Pfad                                       | Rolle                                                               |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `packages/agent-adapters/src/opencode.ts`  | schreibt `{env:OPENAI_API_KEY}`-Platzhalter in die opencode-Config  |
| `apps/api/src/services/secret-service.ts`  | `substituteSecretPlaceholders()` rendert `{env:NAME}` → Literalwert |
| `apps/api/src/workers/task-worker.ts`      | Aufruf nach Secret-Resolution, vor Setup-Files-Encoding             |
| `apps/api/src/workers/pr-review-worker.ts` | identisches Muster für PR-Review-Runs                               |

## Rückbau-Plan (nicht vor Umsetzung des Daemon-Plans durchführen)

1. `substituteSecretPlaceholders()` und beide Aufrufstellen entfernen; Setup-Files-Encoding wieder **vor** die Secret-Resolution stellen (Reihenfolge wie vor 2026-09-06).
2. Den `apiKey: "{env:OPENAI_API_KEY}"`-Platzhalter im Adapter beibehalten bzw. durch den vom Daemon bereitgestellten Mechanismus ersetzen (z. B. Secret-Injection über IPC/Unix-Socket durch den PID 1 Daemon, kein Datei-Persistieren).
3. PVCs betroffener Repo-Pods rotieren bzw. `~/.config/opencode/opencode.json` in bereits laufenden Pods löschen; `OPENAI_API_KEY`-Secret rotieren (es stand während der Workaround-Phase im Klartext auf Volumes).
4. Upstream-Re-Check: [anomalyco/opencode#27853](https://github.com/anomalyco/opencode/issues/27853) — falls upstream gefixt (bspw. opencode ≥ 1.80.x laut Maintainer-Angabe), kann der Workaround ebenfalls fallen gelassen werden, sobald das Agent-Image diese Version trägt.

## Verwandte Dokumentation

- Plan, der den Rückbau ermöglicht: [`docs/plans/agent-daemon-pid1.md`](../plans/agent-daemon-pid1.md)
- Upstream-Issue: <https://github.com/anomalyco/opencode/issues/27853>
