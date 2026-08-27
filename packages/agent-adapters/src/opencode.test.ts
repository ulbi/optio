import { describe, it, expect } from "vitest";
import { OpenCodeAdapter } from "./opencode.js";

const adapter = new OpenCodeAdapter();

describe("OpenCodeAdapter", () => {
  describe("type and displayName", () => {
    it("has correct type", () => {
      expect(adapter.type).toBe("opencode");
    });

    it("has correct displayName", () => {
      expect(adapter.displayName).toBe("OpenCode");
    });
  });

  describe("validateSecrets", () => {
    it("returns valid when ANTHROPIC_API_KEY is present", () => {
      const result = adapter.validateSecrets(["ANTHROPIC_API_KEY"]);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("returns valid when OPENAI_API_KEY is present", () => {
      const result = adapter.validateSecrets(["OPENAI_API_KEY"]);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("returns valid when GROQ_API_KEY is present", () => {
      const result = adapter.validateSecrets(["GROQ_API_KEY"]);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("reports missing when no provider keys are present", () => {
      const result = adapter.validateSecrets([]);
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(["ANTHROPIC_API_KEY or OPENAI_API_KEY"]);
    });

    it("reports missing when only unrelated secrets are present", () => {
      const result = adapter.validateSecrets(["GITHUB_TOKEN", "COPILOT_GITHUB_TOKEN"]);
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(["ANTHROPIC_API_KEY or OPENAI_API_KEY"]);
    });
  });

  describe("buildContainerConfig", () => {
    const baseInput = {
      taskId: "test-123",
      prompt: "Fix the bug",
      repoUrl: "https://github.com/org/repo",
      repoBranch: "main",
    };

    it("uses rendered prompt when available", () => {
      const config = adapter.buildContainerConfig({
        ...baseInput,
        renderedPrompt: "Rendered: Fix the bug",
      });
      expect(config.env.OPTIO_PROMPT).toBe("Rendered: Fix the bug");
    });

    it("falls back to raw prompt when no rendered prompt", () => {
      const config = adapter.buildContainerConfig(baseInput);
      expect(config.env.OPTIO_PROMPT).toBe("Fix the bug");
    });

    it("sets correct env vars", () => {
      const config = adapter.buildContainerConfig(baseInput);
      expect(config.env.OPTIO_TASK_ID).toBe("test-123");
      expect(config.env.OPTIO_AGENT_TYPE).toBe("opencode");
      expect(config.env.OPTIO_BRANCH_NAME).toBe("optio/task-test-123");
      expect(config.env.OPTIO_REPO_URL).toBe("https://github.com/org/repo");
      expect(config.env.OPTIO_REPO_BRANCH).toBe("main");
    });

    it("requires provider API key secrets", () => {
      const config = adapter.buildContainerConfig(baseInput);
      expect(config.requiredSecrets).toContain("ANTHROPIC_API_KEY");
      expect(config.requiredSecrets).toContain("OPENAI_API_KEY");
    });

    it("sets OPENCODE_MODEL when opencodeModel is provided", () => {
      const config = adapter.buildContainerConfig({
        ...baseInput,
        opencodeModel: "anthropic/claude-sonnet-4",
      });
      expect(config.env.OPENCODE_MODEL).toBe("anthropic/claude-sonnet-4");
    });

    it("sets OPTIO_OPENCODE_AGENT when opencodeAgent is provided", () => {
      const config = adapter.buildContainerConfig({
        ...baseInput,
        opencodeAgent: "build",
      });
      expect(config.env.OPTIO_OPENCODE_AGENT).toBe("build");
    });

    it("does not set OPTIO_OPENCODE_MODEL or OPTIO_OPENCODE_AGENT when not provided", () => {
      const config = adapter.buildContainerConfig(baseInput);
      expect(config.env.OPTIO_OPENCODE_MODEL).toBeUndefined();
      expect(config.env.OPTIO_OPENCODE_AGENT).toBeUndefined();
    });

    it("sets OPENAI_BASE_URL when opencodeBaseUrl is provided", () => {
      const config = adapter.buildContainerConfig({
        ...baseInput,
        opencodeBaseUrl: "http://lightllm-server:8080/v1",
      });
      expect(config.env.OPENAI_BASE_URL).toBe("http://lightllm-server:8080/v1");
    });

    it("sets placeholder OPENAI_API_KEY when opencodeBaseUrl is provided", () => {
      const config = adapter.buildContainerConfig({
        ...baseInput,
        opencodeBaseUrl: "http://localhost:8080/v1",
      });
      expect(config.env.OPENAI_API_KEY).toBe("sk-no-key-required");
    });

    it("does not require provider API key secrets when opencodeBaseUrl is set but opencodeModeModels is not", () => {
      const config = adapter.buildContainerConfig({
        ...baseInput,
        opencodeBaseUrl: "http://localhost:8080/v1",
      });
      expect(config.requiredSecrets).not.toContain("ANTHROPIC_API_KEY");
      expect(config.requiredSecrets).not.toContain("OPENAI_API_KEY");
    });

    it("requires OPENAI_API_KEY when both opencodeBaseUrl and opencodeModeModels are set", () => {
      const config = adapter.buildContainerConfig({
        ...baseInput,
        opencodeBaseUrl: "http://localhost:8080/v1",
        opencodeModeModels: {
          code: "qwen-2.5-coder",
        },
      });
      expect(config.requiredSecrets).toContain("OPENAI_API_KEY");
      expect(config.requiredSecrets).not.toContain("ANTHROPIC_API_KEY");
    });

    it("does not set OPENAI_BASE_URL when opencodeBaseUrl is not provided", () => {
      const config = adapter.buildContainerConfig(baseInput);
      expect(config.env.OPENAI_BASE_URL).toBeUndefined();
    });

    it("includes opencode config as setup file with LiteLLM Proxy configuration when both opencodeBaseUrl and opencodeModeModels are provided", () => {
      const config = adapter.buildContainerConfig({
        ...baseInput,
        opencodeBaseUrl: "http://lightllm-server:8080/v1",
        opencodeModeModels: {
          plan: "plan-model",
          review: "review-model",
          code: "code-model",
          chat: "chat-model",
          quick: "quick-model",
          lint: "lint-model",
          small: "small-model",
        },
      });
      const configFile = config.setupFiles?.find((f) =>
        f.path.includes(".config/opencode/opencode.json"),
      );
      expect(configFile).toBeDefined();
      const parsedConfig = JSON.parse(configFile!.content);
      expect(parsedConfig).toEqual({
        $schema: "https://opencode.ai/config.json",
        model: "chat-model",
        small_model: "small-model",
        provider: {
          litellm: {
            npm: "@ai-sdk/openai-compatible",
            name: "LiteLLM Proxy",
            options: {
              baseURL: "http://lightllm-server:8080/v1",
              apiKey: "{env:OPENAI_API_KEY}",
            },
            models: {
              "plan-model": { name: "plan-model" },
              "review-model": { name: "review-model" },
              "code-model": { name: "code-model" },
              "chat-model": { name: "chat-model" },
              "quick-model": { name: "quick-model" },
              "lint-model": { name: "lint-model" },
              "small-model": { name: "small-model" },
            },
          },
        },
        agent: {
          build: {
            model: "code-model",
            description: "Default implementation agent",
          },
          plan: {
            model: "litellm/plan-model",
            description: "Planning agent",
            permission: { edit: "deny", bash: "deny" },
          },
          review: {
            mode: "subagent",
            model: "litellm/review-model",
            description: "Code review",
            permission: { edit: "deny", bash: "deny" },
          },
          lint: {
            mode: "subagent",
            model: "litellm/lint-model",
            description: "Linting & fixes",
            permission: { edit: "allow", bash: "allow" },
          },
          quick: {
            mode: "subagent",
            model: "litellm/quick-model",
            description: "Fast responses",
            steps: 5,
          },
        },
      });
    });

    it("omits missing models from the provider.models mapping and agent mappings", () => {
      const config = adapter.buildContainerConfig({
        ...baseInput,
        opencodeBaseUrl: "http://lightllm-server:8080/v1",
        opencodeModeModels: {
          code: "code-model",
          chat: "chat-model",
        },
      });
      const configFile = config.setupFiles?.find((f) =>
        f.path.includes(".config/opencode/opencode.json"),
      );
      expect(configFile).toBeDefined();
      const parsedConfig = JSON.parse(configFile!.content);
      expect(parsedConfig.model).toBe("chat-model");
      expect(parsedConfig.small_model).toBeUndefined();
      expect(parsedConfig.provider.litellm.models).toEqual({
        "code-model": { name: "code-model" },
        "chat-model": { name: "chat-model" },
      });
      expect(parsedConfig.agent).toEqual({
        build: {
          model: "code-model",
          description: "Default implementation agent",
        },
      });
    });

    it("includes opencode config as setup file", () => {
      const config = adapter.buildContainerConfig(baseInput);
      const configFile = config.setupFiles?.find((f) =>
        f.path.includes(".config/opencode/opencode.json"),
      );
      expect(configFile).toBeDefined();
      expect(JSON.parse(configFile!.content)).toEqual({
        $schema: "https://opencode.ai/config.json",
      });
    });

    it("includes task file in setup files when provided", () => {
      const config = adapter.buildContainerConfig({
        ...baseInput,
        taskFileContent: "# Task\nDo something",
        taskFilePath: ".optio/task.md",
      });
      const taskFile = config.setupFiles?.find((f) => f.path === ".optio/task.md");
      expect(taskFile).toBeDefined();
      expect(taskFile!.content).toBe("# Task\nDo something");
    });

    it("returns only opencode config in setupFiles when no task file", () => {
      const config = adapter.buildContainerConfig(baseInput);
      expect(config.setupFiles).toHaveLength(1);
      expect(config.setupFiles![0].path).toContain("opencode.json");
    });

    it("uses entrypoint.sh as command", () => {
      const config = adapter.buildContainerConfig(baseInput);
      expect(config.command).toEqual(["/opt/optio/entrypoint.sh"]);
    });
  });

  describe("State 1: Native Provider (Anthropic/OpenAI/Groq), NO Detail Models", () => {
    const baseInput = {
      taskId: "test-123",
      prompt: "Fix the bug",
      repoUrl: "https://github.com/org/repo",
      repoBranch: "main",
    };

    describe("1a - Native Anthropic, only ANTHROPIC_API_KEY set", () => {
      it("sets opencode.json with only $schema (no model, no provider config)", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "anthropic",
        });
        const configFile = config.setupFiles?.find((f) =>
          f.path.includes(".config/opencode/opencode.json"),
        );
        expect(configFile).toBeDefined();
        expect(JSON.parse(configFile!.content)).toEqual({
          $schema: "https://opencode.ai/config.json",
        });
      });

      it("sets ANTHROPIC_API_KEY env var and no OPENCODE_MODEL", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "anthropic",
        });
        expect(config.env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(config.env.OPENAI_API_KEY).toBeUndefined();
        expect(config.env.GROQ_API_KEY).toBeUndefined();
        expect(config.env.OPENCODE_MODEL).toBeUndefined();
        expect(config.env.OPTIO_OPENCODE_MODEL).toBeUndefined();
      });

      it("requires ANTHROPIC_API_KEY and OPENAI_API_KEY for native mode", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "anthropic",
        });
        expect(config.requiredSecrets).toContain("ANTHROPIC_API_KEY");
        expect(config.requiredSecrets).toContain("OPENAI_API_KEY");
      });
    });

    describe("1b - Native Anthropic, ANTHROPIC_API_KEY + OPENCODE_DEFAULT_MODEL set", () => {
      it("sets opencode.json with only $schema (model via env var)", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "anthropic",
          opencodeModel: "claude-sonnet-4",
        });
        const configFile = config.setupFiles?.find((f) =>
          f.path.includes(".config/opencode/opencode.json"),
        );
        expect(configFile).toBeDefined();
        expect(JSON.parse(configFile!.content)).toEqual({
          $schema: "https://opencode.ai/config.json",
        });
      });

      it("sets OPENCODE_MODEL env var with default model", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "anthropic",
          opencodeModel: "claude-sonnet-4",
        });
        expect(config.env.OPENCODE_MODEL).toBe("claude-sonnet-4");
      });

      it("requires ANTHROPIC_API_KEY and OPENAI_API_KEY for native mode", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "anthropic",
          opencodeModel: "claude-sonnet-4",
        });
        expect(config.requiredSecrets).toContain("ANTHROPIC_API_KEY");
        expect(config.requiredSecrets).toContain("OPENAI_API_KEY");
      });
    });

    describe("1c - Native OpenAI, only OPENAI_API_KEY set", () => {
      it("sets opencode.json with only $schema (no model, no provider config)", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "openai",
        });
        const configFile = config.setupFiles?.find((f) =>
          f.path.includes(".config/opencode/opencode.json"),
        );
        expect(configFile).toBeDefined();
        expect(JSON.parse(configFile!.content)).toEqual({
          $schema: "https://opencode.ai/config.json",
        });
      });

      it("requires ANTHROPIC_API_KEY and OPENAI_API_KEY for native mode", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "openai",
        });
        expect(config.requiredSecrets).toContain("ANTHROPIC_API_KEY");
        expect(config.requiredSecrets).toContain("OPENAI_API_KEY");
      });
    });

    describe("1d - Native OpenAI, OPENAI_API_KEY + OPENCODE_DEFAULT_MODEL set", () => {
      it("sets opencode.json with only $schema (model via env var)", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "openai",
          opencodeModel: "gpt-4o",
        });
        const configFile = config.setupFiles?.find((f) =>
          f.path.includes(".config/opencode/opencode.json"),
        );
        expect(configFile).toBeDefined();
        expect(JSON.parse(configFile!.content)).toEqual({
          $schema: "https://opencode.ai/config.json",
        });
      });

      it("sets OPENCODE_MODEL env var with default model", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "openai",
          opencodeModel: "gpt-4o",
        });
        expect(config.env.OPENCODE_MODEL).toBe("gpt-4o");
      });
    });

    describe("1e - Native Groq, only GROQ_API_KEY set", () => {
      it("sets opencode.json with only $schema (no model, no provider config)", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "groq",
        });
        const configFile = config.setupFiles?.find((f) =>
          f.path.includes(".config/opencode/opencode.json"),
        );
        expect(configFile).toBeDefined();
        expect(JSON.parse(configFile!.content)).toEqual({
          $schema: "https://opencode.ai/config.json",
        });
      });

      it("requires ANTHROPIC_API_KEY and OPENAI_API_KEY for native mode", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "groq",
        });
        expect(config.requiredSecrets).toContain("ANTHROPIC_API_KEY");
        expect(config.requiredSecrets).toContain("OPENAI_API_KEY");
      });
    });

    describe("1f - Native Groq, GROQ_API_KEY + OPENCODE_DEFAULT_MODEL set", () => {
      it("sets opencode.json with only $schema (model via env var)", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "groq",
          opencodeModel: "llama-3.1-70b",
        });
        const configFile = config.setupFiles?.find((f) =>
          f.path.includes(".config/opencode/opencode.json"),
        );
        expect(configFile).toBeDefined();
        expect(JSON.parse(configFile!.content)).toEqual({
          $schema: "https://opencode.ai/config.json",
        });
      });

      it("sets OPENCODE_MODEL env var with default model", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "groq",
          opencodeModel: "llama-3.1-70b",
        });
        expect(config.env.OPENCODE_MODEL).toBe("llama-3.1-70b");
      });
    });

    describe("1g - Native Anthropic, multiple provider keys set", () => {
      it("sets opencode.json with only $schema (no provider config in native mode)", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "anthropic",
        });
        const configFile = config.setupFiles?.find((f) =>
          f.path.includes(".config/opencode/opencode.json"),
        );
        expect(configFile).toBeDefined();
        expect(JSON.parse(configFile!.content)).toEqual({
          $schema: "https://opencode.ai/config.json",
        });
        expect(JSON.parse(configFile!.content).provider).toBeUndefined();
      });

      it("does not inject provider keys into env when no baseUrl (secrets will be injected by orchestrator)", () => {
        const config = adapter.buildContainerConfig({
          ...baseInput,
          opencodeProvider: "anthropic",
        });
        expect(config.env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(config.env.OPENAI_API_KEY).toBeUndefined();
        expect(config.env.OPENCODE_MODEL).toBeUndefined();
        expect(config.env.OPTIO_OPENCODE_MODEL).toBeUndefined();
      });
    });
  });

  describe("State 5: LiteLLM Provider, Default + Detail Models, NO OPENAI_API_KEY Secret", () => {
    describe("5a - LiteLLM with detail models, no API key", () => {
      it("sets opencode.json with LiteLLM provider, chat model as top-level model, code model in agent.build", () => {
        const config = adapter.buildContainerConfig({
          taskId: "test-123",
          prompt: "Fix the bug",
          repoUrl: "https://github.com/org/repo",
          repoBranch: "main",
          opencodeProvider: "litellm",
          opencodeBaseUrl: "http://litellm-proxy.agents.svc.cluster.local:4000",
          opencodeModel: "fallback-model",
          opencodeModeModels: {
            chat: "gpt-4o",
            code: "qwen-coder",
          },
        });
        const configFile = config.setupFiles?.find((f) =>
          f.path.includes(".config/opencode/opencode.json"),
        );
        expect(configFile).toBeDefined();
        const parsedConfig = JSON.parse(configFile!.content);
        expect(parsedConfig).toEqual({
          $schema: "https://opencode.ai/config.json",
          model: "gpt-4o",
          provider: {
            litellm: {
              npm: "@ai-sdk/openai-compatible",
              name: "LiteLLM Proxy",
              options: {
                baseURL: "http://litellm-proxy.agents.svc.cluster.local:4000",
                apiKey: "{env:OPENAI_API_KEY}",
              },
              models: {
                "gpt-4o": { name: "gpt-4o" },
                "qwen-coder": { name: "qwen-coder" },
                "fallback-model": { name: "fallback-model" },
              },
            },
          },
          agent: {
            build: {
              model: "qwen-coder",
              description: "Default implementation agent",
            },
          },
        });
      });

      it("sets placeholder OPENAI_API_KEY when no secret is configured", () => {
        const config = adapter.buildContainerConfig({
          taskId: "test-123",
          prompt: "Fix the bug",
          repoUrl: "https://github.com/org/repo",
          repoBranch: "main",
          opencodeProvider: "litellm",
          opencodeBaseUrl: "http://litellm-proxy.agents.svc.cluster.local:4000",
          opencodeModel: "fallback-model",
          opencodeModeModels: {
            chat: "gpt-4o",
            code: "qwen-coder",
          },
        });
        expect(config.env.OPENAI_API_KEY).toBe("sk-no-key-required");
      });

      it("sets OPENAI_BASE_URL when opencodeBaseUrl is provided", () => {
        const config = adapter.buildContainerConfig({
          taskId: "test-123",
          prompt: "Fix the bug",
          repoUrl: "https://github.com/org/repo",
          repoBranch: "main",
          opencodeProvider: "litellm",
          opencodeBaseUrl: "http://litellm-proxy.agents.svc.cluster.local:4000",
          opencodeModel: "fallback-model",
          opencodeModeModels: {
            chat: "gpt-4o",
            code: "qwen-coder",
          },
        });
        expect(config.env.OPENAI_BASE_URL).toBe("http://litellm-proxy.agents.svc.cluster.local:4000");
      });

      it("sets OPENCODE_MODEL to chat model from detail models", () => {
        const config = adapter.buildContainerConfig({
          taskId: "test-123",
          prompt: "Fix the bug",
          repoUrl: "https://github.com/org/repo",
          repoBranch: "main",
          opencodeProvider: "litellm",
          opencodeBaseUrl: "http://litellm-proxy.agents.svc.cluster.local:4000",
          opencodeModel: "fallback-model",
          opencodeModeModels: {
            chat: "gpt-4o",
            code: "qwen-coder",
          },
        });
        expect(config.env.OPENCODE_MODEL).toBe("gpt-4o");
      });

      it("requires OPENAI_API_KEY when both opencodeBaseUrl and opencodeModeModels are set", () => {
        const config = adapter.buildContainerConfig({
          taskId: "test-123",
          prompt: "Fix the bug",
          repoUrl: "https://github.com/org/repo",
          repoBranch: "main",
          opencodeProvider: "litellm",
          opencodeBaseUrl: "http://litellm-proxy.agents.svc.cluster.local:4000",
          opencodeModel: "fallback-model",
          opencodeModeModels: {
            chat: "gpt-4o",
            code: "qwen-coder",
          },
        });
        expect(config.requiredSecrets).toContain("OPENAI_API_KEY");
      });
    });
  });

  describe("State 6: LiteLLM Provider, Default + Detail Models, WITH OPENAI_API_KEY Secret", () => {
    describe("6a - LiteLLM with detail models, API key present", () => {
      it("sets opencode.json the same as State 5a", () => {
        const config = adapter.buildContainerConfig({
          taskId: "test-123",
          prompt: "Fix the bug",
          repoUrl: "https://github.com/org/repo",
          repoBranch: "main",
          opencodeProvider: "litellm",
          opencodeBaseUrl: "http://litellm-proxy.agents.svc.cluster.local:4000",
          opencodeModel: "fallback-model",
          opencodeModeModels: {
            chat: "gpt-4o",
            code: "qwen-coder",
          },
        });
        const configFile = config.setupFiles?.find((f) =>
          f.path.includes(".config/opencode/opencode.json"),
        );
        expect(configFile).toBeDefined();
        const parsedConfig = JSON.parse(configFile!.content);
        expect(parsedConfig.model).toBe("gpt-4o");
        expect(parsedConfig.provider.litellm.options.baseURL).toBe(
          "http://litellm-proxy.agents.svc.cluster.local:4000",
        );
        expect(parsedConfig.provider.litellm.options.apiKey).toBe("{env:OPENAI_API_KEY}");
        expect(parsedConfig.provider.litellm.models).toEqual({
          "gpt-4o": { name: "gpt-4o" },
          "qwen-coder": { name: "qwen-coder" },
          "fallback-model": { name: "fallback-model" },
        });
        expect(parsedConfig.agent.build.model).toBe("qwen-coder");
      });

      it("will have OPENAI_API_KEY injected from secret (secrets injected by orchestrator)", () => {
        const config = adapter.buildContainerConfig({
          taskId: "test-123",
          prompt: "Fix the bug",
          repoUrl: "https://github.com/org/repo",
          repoBranch: "main",
          opencodeProvider: "litellm",
          opencodeBaseUrl: "http://litellm-proxy.agents.svc.cluster.local:4000",
          opencodeModel: "fallback-model",
          opencodeModeModels: {
            chat: "gpt-4o",
            code: "qwen-coder",
          },
        });
        expect(config.env.OPENAI_API_KEY).toBe("sk-no-key-required");
        expect(config.requiredSecrets).toContain("OPENAI_API_KEY");
      });

      it("sets OPENAI_BASE_URL when opencodeBaseUrl is provided", () => {
        const config = adapter.buildContainerConfig({
          taskId: "test-123",
          prompt: "Fix the bug",
          repoUrl: "https://github.com/org/repo",
          repoBranch: "main",
          opencodeProvider: "litellm",
          opencodeBaseUrl: "http://litellm-proxy.agents.svc.cluster.local:4000",
          opencodeModel: "fallback-model",
          opencodeModeModels: {
            chat: "gpt-4o",
            code: "qwen-coder",
          },
        });
        expect(config.env.OPENAI_BASE_URL).toBe("http://litellm-proxy.agents.svc.cluster.local:4000");
      });

      it("sets OPENCODE_MODEL to chat model from detail models", () => {
        const config = adapter.buildContainerConfig({
          taskId: "test-123",
          prompt: "Fix the bug",
          repoUrl: "https://github.com/org/repo",
          repoBranch: "main",
          opencodeProvider: "litellm",
          opencodeBaseUrl: "http://litellm-proxy.agents.svc.cluster.local:4000",
          opencodeModel: "fallback-model",
          opencodeModeModels: {
            chat: "gpt-4o",
            code: "qwen-coder",
          },
        });
        expect(config.env.OPENCODE_MODEL).toBe("gpt-4o");
      });
    });
  });

  describe("parseResult", () => {
    it("returns success for exit code 0 with no errors", () => {
      const result = adapter.parseResult(0, "some output\nmore output");
      expect(result.success).toBe(true);
      expect(result.summary).toBe("Agent completed successfully");
      expect(result.error).toBeUndefined();
    });

    it("returns failure for non-zero exit code", () => {
      const result = adapter.parseResult(1, "some output");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Exit code: 1");
    });

    it("extracts GitHub PR URL from logs", () => {
      const logs = `Working on task...\nhttps://github.com/org/repo/pull/42\nDone!`;
      const result = adapter.parseResult(0, logs);
      expect(result.prUrl).toBe("https://github.com/org/repo/pull/42");
    });

    it("extracts GitLab MR URL from logs", () => {
      const logs = `Working on task...\nhttps://gitlab.com/org/repo/-/merge_requests/7\nDone!`;
      const result = adapter.parseResult(0, logs);
      expect(result.prUrl).toBe("https://gitlab.com/org/repo/-/merge_requests/7");
    });

    it("extracts summary from last assistant message", () => {
      const logs = [
        '{"type":"message","role":"assistant","content":"Starting work"}',
        '{"type":"message","role":"assistant","content":"All done, PR created"}',
      ].join("\n");
      const result = adapter.parseResult(0, logs);
      expect(result.summary).toBe("All done, PR created");
    });

    it("extracts summary from result event", () => {
      const logs = '{"type":"result","result":"Task completed successfully"}';
      const result = adapter.parseResult(0, logs);
      expect(result.summary).toBe("Task completed successfully");
    });

    it("truncates long summaries", () => {
      const longMsg = "x".repeat(300);
      const logs = `{"type":"message","role":"assistant","content":"${longMsg}"}`;
      const result = adapter.parseResult(0, logs);
      expect(result.summary!.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    });

    it("uses total_cost_usd when provided directly", () => {
      const logs = '{"type":"result","total_cost_usd":0.0534}';
      const result = adapter.parseResult(0, logs);
      expect(result.costUsd).toBe(0.0534);
    });

    it("leaves cost undefined when not provided", () => {
      const logs = '{"type":"message","role":"assistant","content":"Done"}';
      const result = adapter.parseResult(0, logs);
      expect(result.costUsd).toBeUndefined();
    });

    it("detects error events in JSON output", () => {
      const logs = '{"type":"error","message":"Provider API key is invalid"}';
      const result = adapter.parseResult(0, logs);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Provider API key is invalid");
    });

    it("detects error envelope in JSON output", () => {
      const logs =
        '{"error":{"message":"Invalid API key","type":"auth_error","code":"invalid_key"}}';
      const result = adapter.parseResult(0, logs);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid API key");
    });

    it("detects is_error result events", () => {
      const logs = '{"is_error":true,"result":"Authentication failed"}';
      const result = adapter.parseResult(0, logs);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Authentication failed");
    });

    it("extracts token usage from events", () => {
      const logs = [
        '{"type":"message","role":"assistant","content":"Done","usage":{"input_tokens":1000,"output_tokens":500}}',
      ].join("\n");
      const result = adapter.parseResult(0, logs);
      expect(result.inputTokens).toBe(1000);
      expect(result.outputTokens).toBe(500);
    });

    it("includes cache_read and cache_creation tokens in input total", () => {
      const logs =
        '{"type":"message","role":"assistant","content":"Done","usage":{"input_tokens":50,"output_tokens":200,"cache_creation_input_tokens":1000,"cache_read_input_tokens":5000}}';
      const result = adapter.parseResult(0, logs);
      expect(result.inputTokens).toBe(6050);
      expect(result.outputTokens).toBe(200);
    });

    it("extracts token usage from OpenAI-style naming", () => {
      const logs =
        '{"type":"message","role":"assistant","content":"Done","usage":{"prompt_tokens":2000,"completion_tokens":1000}}';
      const result = adapter.parseResult(0, logs);
      expect(result.inputTokens).toBe(2000);
      expect(result.outputTokens).toBe(1000);
    });

    it("extracts model from events", () => {
      const logs =
        '{"model":"anthropic/claude-sonnet-4","type":"message","role":"assistant","content":"Hi"}';
      const result = adapter.parseResult(0, logs);
      expect(result.model).toBe("anthropic/claude-sonnet-4");
    });

    it("detects auth errors in raw text", () => {
      const logs = "Error: ANTHROPIC_API_KEY authentication failed";
      const result = adapter.parseResult(1, logs);
      expect(result.success).toBe(false);
      expect(result.error).toContain("ANTHROPIC_API_KEY");
    });

    it("detects model not found errors in raw text", () => {
      const logs = "Error: model_not_found - The model does not exist";
      const result = adapter.parseResult(1, logs);
      expect(result.success).toBe(false);
      expect(result.error).toContain("model_not_found");
    });

    it("detects server errors in raw text", () => {
      const logs = "Error: 503 service unavailable";
      const result = adapter.parseResult(1, logs);
      expect(result.success).toBe(false);
      expect(result.error).toContain("503");
    });

    it("handles empty logs gracefully", () => {
      const result = adapter.parseResult(0, "");
      expect(result.success).toBe(true);
      expect(result.costUsd).toBeUndefined();
      expect(result.inputTokens).toBeUndefined();
      expect(result.outputTokens).toBeUndefined();
      expect(result.model).toBeUndefined();
    });

    it("does not compute cost from tokens (provider-agnostic)", () => {
      const logs =
        '{"type":"message","role":"assistant","content":"Done","usage":{"input_tokens":1000,"output_tokens":500}}';
      const result = adapter.parseResult(0, logs);
      // OpenCode is provider-agnostic — no per-token cost calculation
      expect(result.costUsd).toBeUndefined();
    });
  });
});
