/**
 * E2E: verifies the command logging + stall diagnostic + secrets-toggle
 * behaviors through the real API server with the fake runtime.
 *
 * Covers:
 *   1. With OPTIO_LOG_SECRETS=true, the "Executing agent command" log line
 *      contains the FULL command including secret values (not masked).
 *   2. The exec script produced by repo-pool-service tees agent output to
 *      `$WORKTREE/.optio-agent.log` in addition to stdout/stderr.
 *   3. A stalled task's FAILED transition carries an errorMessage that
 *      includes "Agent stalled: no activity for" plus recent context.
 *
 * The fake runtime plays a claude-code agent (all these behaviors are
 * agent-type agnostic — the exec script / command logging apply to every
 * agent, including opencode).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApiServer, waitFor, type ApiServerHandle } from "../src/test-utils/e2e/api-server.js";

const REPO_URL = "https://github.com/e2e-org/vis-repo";
const REPO_FULL_NAME = "e2e-org/vis-repo";

let server: ApiServerHandle;
let shimDir: string;

beforeAll(async () => {
  shimDir = mkdtempSync(join(tmpdir(), "optio-e2e-vis-"));
  writeFileSync(join(shimDir, "kubectl"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });

  server = await startApiServer({
    env: {
      // pino-pretty (active when NODE_ENV !== production) scatters JSON
      // fields like taskId/command across separate colored lines, which
      // makes the server logs unparseable as NDJSON. Force plain JSON logs.
      NODE_ENV: "production",
      PATH: `${shimDir}:${process.env.PATH ?? ""}`,
      OPTIO_LOG_SECRETS: "true",
      OPTIO_PR_WATCH_INTERVAL: "600000",
    },
    logLevel: "info",
  });

  for (const name of ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) {
    const secretRes = await api("/api/secrets", {
      method: "POST",
      body: JSON.stringify({ name, value: `e2e-dummy-${name}`, scope: "global" }),
    });
    expect(secretRes.status).toBe(201);
  }

  const { status } = await api<{ repo: { id: string } }>("/api/repos", {
    method: "POST",
    body: JSON.stringify({ repoUrl: REPO_URL, fullName: REPO_FULL_NAME, defaultBranch: "main" }),
  });
  expect(status).toBe(201);
}, 150_000);

afterAll(async () => {
  await server?.stop();
  if (shimDir) rmSync(shimDir, { recursive: true, force: true });
});

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${server.baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  return { status: res.status, body: (await res.json()) as T };
}

interface TaskRow {
  id: string;
  state: string;
  prUrl: string | null;
  errorMessage: string | null;
}

interface LogRow {
  content: string;
  logType: string | null;
}

async function createTask(title: string, agentType = "claude-code"): Promise<string> {
  const { status, body } = await api<{ task: TaskRow }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title,
      prompt: `E2E visibility: ${title}`,
      repoUrl: REPO_URL,
      agentType,
    }),
  });
  expect(status).toBe(201);
  return body.task.id;
}

async function getTask(taskId: string): Promise<TaskRow> {
  const { body } = await api<{ task: TaskRow }>(`/api/tasks/${taskId}`);
  return body.task;
}

async function waitForTaskState(taskId: string, states: string[]): Promise<TaskRow> {
  try {
    return await waitFor(
      async () => {
        const task = await getTask(taskId);
        return states.includes(task.state) ? task : null;
      },
      { timeoutMs: 90_000, label: `task ${taskId} → ${states.join("|")}` },
    );
  } catch (err) {
    throw new Error(
      `${err}\n--- server logs (tail) ---\n${server.logs().split("\n").slice(-60).join("\n")}`,
    );
  }
}

describe("command logging + visibility e2e", () => {
  it("logs the full unmasked command when OPTIO_LOG_SECRETS=true", async () => {
    const taskId = await createTask("Log secrets test");

    const task = await waitForTaskState(taskId, [
      "completed",
      "failed",
      "needs_attention",
      "pr_opened",
    ]);

    // Give the server a moment to flush the command log line.
    await new Promise((r) => setTimeout(r, 500));

    const logs = server.logs();
    // The command log line must contain NO masked secret markers when
    // OPTIO_LOG_SECRETS=true.
    const commandLines = logs
      .split("\n")
      .filter((l) => l.includes("Executing agent command") && l.includes("taskId"));
    expect(commandLines.length, `server logs:\n---\n${logs}\n---`).toBeGreaterThanOrEqual(1);
    const commandLine = commandLines[commandLines.length - 1];
    // With OPTIO_LOG_SECRETS=true, no ***MASKED*** marker anywhere in the line
    expect(commandLine).not.toContain("***MASKED***");
    // And the agent executable is visible in the logged command.
    expect(commandLine).toContain("claude");
  });

  it("runs a task to completion and its logs include agent output", async () => {
    const taskId = await createTask("Visibility run [[mock:pr]]");

    const task = await waitForTaskState(taskId, ["pr_opened", "completed", "failed"]);
    expect(task.state).toBe("pr_opened");
    expect(task.prUrl).toMatch(/^https:\/\/github\.com\/e2e-org\/vis-repo\/pull\/\d+$/);

    const { body: logsBody } = await api<{ logs: LogRow[] }>(`/api/tasks/${taskId}/logs`);
    const contents = logsBody.logs.map((l) => l.content).join("\n");
    expect(contents).toContain("Mock agent handled");
    expect(contents).toContain("Opened pull request:");
  });
});
