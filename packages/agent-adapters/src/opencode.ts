import type {
  AgentTaskInput,
  AgentContainerConfig,
  AgentResult,
  OpenCodeProvider,
} from "@optio/shared";
import { TASK_BRANCH_PREFIX } from "@optio/shared";
import type { AgentAdapter } from "./types.js";

/**
 * OpenCode CLI (opencode run --format json) outputs NDJSON events.
 * Each line is a JSON object. The exact schema is not fully documented,
 * but known shapes include:
 *
 * - { type: "message", role: "assistant"|"system", content: "..." }
 * - { type: "tool_call", name: "...", arguments: "..." }
 * - { type: "tool_result", call_id: "...", output: "..." }
 * - { type: "error", message: "..." }
 * - Events with usage data (input_tokens, output_tokens)
 *
 * The parser is conservative — unrecognized events are skipped.
 *
 * NOTE: OpenCode support is EXPERIMENTAL. The JSON output schema is
 * not exhaustively documented and may change between versions.
 */

interface OpencodeConfig {
  $schema: string;
  model?: string;
  small_model?: string;
  provider?: Record<string, unknown>;
  agent?: Record<string, unknown>;
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly type = "opencode";
  readonly displayName = "OpenCode";

  validateSecrets(availableSecrets: string[]): { valid: boolean; missing: string[] } {
    // OpenCode is provider-agnostic — it needs at least one provider API key.
    // Note: when opencodeBaseUrl is set with a provider, buildContainerConfig()
    // skips requiredSecrets and injects a placeholder key, so missing provider keys won't block execution.
    const acceptedKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY"];
    const hasAny = acceptedKeys.some((k) => availableSecrets.includes(k));
    return {
      valid: hasAny,
      missing: hasAny ? [] : ["ANTHROPIC_API_KEY or OPENAI_API_KEY"],
    };
  }

  buildContainerConfig(input: AgentTaskInput): AgentContainerConfig {
    const prompt = input.renderedPrompt ?? input.prompt;

    const env: Record<string, string> = {
      OPTIO_TASK_ID: input.taskId,
      OPTIO_REPO_URL: input.repoUrl,
      OPTIO_REPO_BRANCH: input.repoBranch,
      OPTIO_PROMPT: prompt,
      OPTIO_AGENT_TYPE: "opencode",
      OPTIO_BRANCH_NAME: `${TASK_BRANCH_PREFIX}${input.taskId}`,
    };

    // OpenCode reads provider-specific env vars directly (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
    // These are injected via requiredSecrets
    const requiredSecrets: string[] = [];

    const hasProviderConfig = !!(input.opencodeProvider && input.opencodeBaseUrl);

    // When using a provider with custom base URL, provider API keys are optional — the adapter
    // sets a placeholder OPENAI_API_KEY in env that will be overridden if a real secret exists.
    // Without a provider config, require standard provider keys for native OpenCode.
    if (!hasProviderConfig) {
      requiredSecrets.push("ANTHROPIC_API_KEY", "OPENAI_API_KEY");
    } else {
      // For proxy providers, we need OPENAI_API_KEY for the proxy
      requiredSecrets.push("OPENAI_API_KEY");
    }

    const setupFiles: AgentContainerConfig["setupFiles"] = [];

    // Set model if configured (e.g. "anthropic/claude-sonnet-4")
    if (input.opencodeModel) {
      env.OPTIO_OPENCODE_MODEL = input.opencodeModel;
    }
    // Set named agent if configured (e.g. "build", "plan")
    if (input.opencodeAgent) {
      env.OPTIO_OPENCODE_AGENT = input.opencodeAgent;
    }

    // Custom OpenAI-compatible endpoint (e.g. vLLM, lightllm, Ollama) via provider config
    if (hasProviderConfig) {
      env.OPENAI_BASE_URL = input.opencodeBaseUrl!;
      // Local endpoints typically don't require a real API key — set a
      // placeholder that gets overridden if a real secret is configured.
      env.OPENAI_API_KEY = "sk-no-key-required";
    }

    // Build the opencode.json config
    const config = this.buildOpencodeConfig(input, hasProviderConfig);

    setupFiles.push({
      path: "/home/agent/.config/opencode/opencode.json",
      content: JSON.stringify(config, null, 2),
    });

    // Write the task file into the worktree
    if (input.taskFileContent && input.taskFilePath) {
      setupFiles.push({
        path: input.taskFilePath,
        content: input.taskFileContent,
      });
    }

    return {
      command: ["/opt/optio/entrypoint.sh"],
      env,
      requiredSecrets,
      setupFiles,
    };
  }

  private buildOpencodeConfig(input: AgentTaskInput, hasProviderConfig: boolean): OpencodeConfig {
    const config: OpencodeConfig = {
      $schema: "https://opencode.ai/config.json",
    };

    // Apply mode models - ALWAYS, regardless of provider
    // These are provider-independent model selections for each mode
    if (input.opencodeModeModels) {
      const { plan, review, code, chat, quick, lint, small } = input.opencodeModeModels;

      if (chat) {
        config.model = chat;
      }
      if (small) {
        config.small_model = small;
      }

      config.agent = {};
      if (code) {
        config.agent.build = {
          model: code,
          description: "Default implementation agent",
        };
      }
      if (plan) {
        config.agent.plan = {
          model: plan,
          description: "Planning agent",
          permission: { edit: "deny", bash: "deny" },
        };
      }
      if (review) {
        config.agent.review = {
          mode: "subagent",
          model: review,
          description: "Code review",
          permission: { edit: "deny", bash: "deny" },
        };
      }
      if (lint) {
        config.agent.lint = {
          mode: "subagent",
          model: lint,
          description: "Linting & fixes",
          permission: { edit: "allow", bash: "allow" },
        };
      }
      if (quick) {
        config.agent.quick = {
          mode: "subagent",
          model: quick,
          description: "Fast responses",
          steps: 5,
        };
      }
    }

    // Provider-specific configuration - ONLY when explicitly configured
    if (hasProviderConfig) {
      const provider = input.opencodeProvider!;
      const baseUrl = input.opencodeBaseUrl!;

      if (provider === "litellm") {
        config.provider = {
          litellm: {
            npm: "@ai-sdk/openai-compatible",
            name: "LiteLLM Proxy",
            options: {
              baseURL: baseUrl,
              apiKey: "{env:OPENAI_API_KEY}",
            },
            models: this.buildModelsMap(input.opencodeModeModels),
          },
        };
      } else if (provider === "openai-compatible") {
        config.provider = {
          "openai-compatible": {
            npm: "@ai-sdk/openai-compatible",
            name: "OpenAI Compatible",
            options: {
              baseURL: baseUrl,
              apiKey: "{env:OPENAI_API_KEY}",
            },
            models: this.buildModelsMap(input.opencodeModeModels),
          },
        };
      }
      // "native" provider = no provider config, OpenCode uses its own defaults
    }

    return config;
  }

  private buildModelsMap(
    modeModels: AgentTaskInput["opencodeModeModels"],
  ): Record<string, { name: string }> {
    if (!modeModels) return {};

    const models: Record<string, { name: string }> = {};
    const allModelNames = [
      modeModels.plan,
      modeModels.review,
      modeModels.code,
      modeModels.chat,
      modeModels.quick,
      modeModels.lint,
      modeModels.small,
    ].filter((m): m is string => typeof m === "string" && m.trim().length > 0);

    for (const m of allModelNames) {
      models[m] = { name: m };
    }
    return models;
  }

  parseResult(exitCode: number, logs: string): AgentResult {
    const prMatch = logs.match(
      /https:\/\/(?![\w.-]+\/api\/)[^\s"]+\/(?:pull\/\d+|-\/merge_requests\/\d+)/,
    );
    const { costUsd, errorMessage, hasError, summary, inputTokens, outputTokens, model } =
      this.parseLogs(logs);

    const success = exitCode === 0 && !hasError;

    return {
      success,
      prUrl: prMatch?.[0],
      costUsd,
      inputTokens,
      outputTokens,
      model,
      summary:
        summary ??
        (success ? "Agent completed successfully" : `Agent exited with code ${exitCode}`),
      error: !success ? (errorMessage ?? `Exit code: ${exitCode}`) : undefined,
    };
  }

  private parseLogs(logs: string): {
    costUsd?: number;
    errorMessage?: string;
    hasError: boolean;
    summary?: string;
    inputTokens?: number;
    outputTokens?: number;
    model?: string;
  } {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let directCost: number | undefined;
    let model: string | undefined;
    let errorMessage: string | undefined;
    let hasError = false;
    let lastAssistantMessage: string | undefined;

    for (const line of logs.split("\n")) {
      if (!line.trim()) continue;

      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        if (!errorMessage && isRawTextError(line)) {
          errorMessage = line.trim();
          hasError = true;
          // Log raw error for diagnostics (helps catch API key issues, auth failures, etc.)
          console.warn(`[opencode] Raw error: ${errorMessage}`);
        }
        continue;
      }

      // Extract model name
      if (event.model && !model) {
        model = event.model;
      }

      // Error envelope: { error: { message, type, code } }
      if (event.error && typeof event.error === "object" && event.error.message) {
        errorMessage = event.error.message;
        hasError = true;
        continue;
      }

      // Error events: { type: "error", message: "..." }
      if (event.type === "error") {
        errorMessage = event.message ?? event.error ?? JSON.stringify(event);
        hasError = true;
        continue;
      }

      // Result with is_error flag
      if (event.is_error === true && event.result) {
        errorMessage =
          typeof event.result === "string" ? event.result : JSON.stringify(event.result);
        hasError = true;
        continue;
      }

      // Track assistant messages for summary
      if (event.type === "message" && event.role === "assistant" && event.content) {
        if (typeof event.content === "string") {
          lastAssistantMessage = event.content;
        }
      }

      // Result event with summary
      if (event.type === "result" && event.result && !event.is_error) {
        if (typeof event.result === "string") {
          lastAssistantMessage = event.result;
        }
      }

      // Extract usage data
      const usage = event.usage ?? event.response?.usage;
      if (usage) {
        if (usage.input_tokens) totalInputTokens += usage.input_tokens;
        if (usage.output_tokens) totalOutputTokens += usage.output_tokens;
        if (usage.cache_creation_input_tokens)
          totalInputTokens += usage.cache_creation_input_tokens;
        if (usage.cache_read_input_tokens) totalInputTokens += usage.cache_read_input_tokens;
        if (usage.prompt_tokens) totalInputTokens += usage.prompt_tokens;
        if (usage.completion_tokens) totalOutputTokens += usage.completion_tokens;
      }

      if (event.total_cost_usd != null) {
        directCost = event.total_cost_usd;
      }
    }

    // OpenCode is provider-agnostic — cost may not be available.
    // Use direct cost if reported, otherwise leave undefined.
    const costUsd = directCost;

    return {
      costUsd,
      errorMessage,
      hasError,
      summary: lastAssistantMessage ? truncate(lastAssistantMessage, 200) : undefined,
      inputTokens: totalInputTokens > 0 ? totalInputTokens : undefined,
      outputTokens: totalOutputTokens > 0 ? totalOutputTokens : undefined,
      model,
    };
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\u2026";
}

/** Detect common OpenCode error patterns in non-JSON output lines */
function isRawTextError(line: string): boolean {
  // Auth / API key errors
  if (
    /error|failed|fatal/i.test(line) &&
    /ANTHROPIC_API_KEY|OPENAI_API_KEY|GROQ_API_KEY|api.?key|authentication|unauthorized|forbidden/i.test(
      line,
    )
  ) {
    return true;
  }
  // Provider errors
  if (/invalid.*key|key.*invalid|api.*error/i.test(line)) {
    return true;
  }
  // Model not found
  if (/model.*not found|model_not_found|does not exist|invalid.*model/i.test(line)) {
    return true;
  }
  // Server errors
  if (/server.?error|internal.?error|service.?unavailable|503|502/i.test(line)) {
    return true;
  }
  return false;
}
