import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellSingleQuote, buildEnvExports, maskSecrets } from "./pod-env.js";

/**
 * Regression payload for the Phase 4F shell-quoting bug: a realistic task
 * prompt with markdown backticks, `$HOME`, wildcard text like `optio/task-*`,
 * literal newlines, and single quotes. It also carries canary commands — if
 * any of them run, the env injection leaked prompt content to the shell.
 */
const HOSTILE_PROMPT = [
  "Fix the `pr_opened` handling before broader autonomous use.",
  "",
  "Steps:",
  "1. Inspect $HOME and run `git status` in the worktree.",
  "2. Don't touch branches named optio/task-* — they belong to other agents.",
  "3. Preserve 'single-quoted' text exactly as written.",
  "```bash",
  "touch injected-from-fenced-block",
  "```",
  "$(touch injected-from-substitution)",
  "`touch injected-from-backquotes`",
  "rm -rf $HOME/should-never-expand",
].join("\n");

function runBash(script: string, cwd: string): string {
  return execFileSync("bash", ["-c", script], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("shellSingleQuote", () => {
  it("wraps plain values in single quotes", () => {
    expect(shellSingleQuote("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellSingleQuote("don't")).toBe("'don'\\''t'");
  });

  it("handles empty strings", () => {
    expect(shellSingleQuote("")).toBe("''");
  });
});

describe("buildEnvExports", () => {
  it("emits one export statement per env entry", () => {
    expect(buildEnvExports({ A: "1", B_2: "two" })).toEqual(["export A='1'", "export B_2='two'"]);
  });

  it("rejects env names bash would not accept as identifiers", () => {
    expect(() => buildEnvExports({ "BAD-NAME": "x" })).toThrow(/Invalid environment variable/);
    expect(() => buildEnvExports({ "PATH; touch pwned": "x" })).toThrow(
      /Invalid environment variable/,
    );
    expect(() => buildEnvExports({ "1LEADING": "x" })).toThrow(/Invalid environment variable/);
  });

  it("round-trips a hostile prompt through bash without executing its contents", () => {
    const dir = mkdtempSync(join(tmpdir(), "pod-env-"));
    try {
      const script = [
        "set -e",
        ...buildEnvExports({
          OPTIO_PROMPT: HOSTILE_PROMPT,
          OPTIO_TASK_ID: "task-1",
        }),
        `printf '%s' "$OPTIO_PROMPT" > prompt-out`,
        `printf '%s' "$OPTIO_TASK_ID" > task-id-out`,
      ].join("\n");

      // Throws on non-zero exit — e.g. "command not found" from a prompt
      // line leaking to the shell under `set -e`.
      const stdout = runBash(script, dir);
      expect(stdout).toBe("");

      // Exact round-trip: newlines, backticks, $HOME, globs, quotes intact.
      expect(readFileSync(join(dir, "prompt-out"), "utf8")).toBe(HOSTILE_PROMPT);
      expect(readFileSync(join(dir, "task-id-out"), "utf8")).toBe("task-1");

      // No canary commands executed — only our two output files exist.
      expect(readdirSync(dir).sort()).toEqual(["prompt-out", "task-id-out"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps values with only quotes and whitespace intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "pod-env-"));
    try {
      const value = `  '  "  \t  '' \n `;
      const script = [
        "set -e",
        ...buildEnvExports({ TRICKY: value }),
        `printf '%s' "$TRICKY" > out`,
      ].join("\n");
      runBash(script, dir);
      expect(readFileSync(join(dir, "out"), "utf8")).toBe(value);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("maskSecrets", () => {
  it("masks known secret keys", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-12345",
      OPENAI_API_KEY: "sk-oai-67890",
      GROQ_API_KEY: "sk-groq-11111",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
      CLAUDE_VERTEX_SERVICE_ACCOUNT_KEY: '{"type":"service_account"}',
      OTHER_TOKEN: "secret",
    };
    const masked = maskSecrets(env);
    expect(masked.ANTHROPIC_API_KEY).toBe("****");
    expect(masked.OPENAI_API_KEY).toBe("****");
    expect(masked.GROQ_API_KEY).toBe("****");
    expect(masked.CLAUDE_CODE_OAUTH_TOKEN).toBe("****");
    expect(masked.CLAUDE_VERTEX_SERVICE_ACCOUNT_KEY).toBe("****");
    expect(masked.OTHER_TOKEN).toBe("****");
  });

  it("does not mask non-secret keys", () => {
    const env = {
      OPTIO_TASK_ID: "task-123",
      OPTIO_REPO_URL: "https://github.com/org/repo",
      OPTIO_PROMPT: "Fix the bug",
    };
    const masked = maskSecrets(env);
    expect(masked).toEqual(env);
  });

  it("masks keys containing API_KEY or TOKEN", () => {
    const env = {
      CUSTOM_API_KEY: "custom-value",
      MY_TOKEN: "token-value",
      NORMAL_KEY: "normal",
    };
    const masked = maskSecrets(env);
    expect(masked.CUSTOM_API_KEY).toBe("****");
    expect(masked.MY_TOKEN).toBe("****");
    expect(masked.NORMAL_KEY).toBe("normal");
  });
});
