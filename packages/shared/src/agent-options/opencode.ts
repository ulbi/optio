import type { ProviderCatalog } from "./types.js";

/**
 * OpenCode is a pass-through to a downstream provider (Anthropic, OpenAI,
 * or a self-hosted OpenAI-compatible endpoint). Model selection is free-text
 * because the full namespace looks like `<provider>/<model>`.
 */
export const OPENCODE_CATALOG: ProviderCatalog = {
  provider: "opencode",
  label: "OpenCode",
  modelField: "opencodeModel",
  modelIsFreeText: true,
  modelPlaceholder: "Default (auto-detect)",
  modelHelpText: "e.g. anthropic/claude-sonnet-4, openai/gpt-4o, meta-llama/Llama-3.1-70B",
  models: [],
  aliases: {},
  options: [
    {
      key: "opencodeProvider",
      label: "Provider",
      kind: "select",
      choices: [
        { value: "anthropic", label: "Anthropic (Claude)" },
        { value: "openai", label: "OpenAI" },
        { value: "groq", label: "Groq" },
        { value: "litellm", label: "LiteLLM" },
        { value: "custom", label: "Custom / Other" },
      ],
      default: "anthropic",
      helpText:
        "Select the upstream provider. 'litellm' enables LiteLLM proxy mode via Custom Base URL. 'custom' allows free-text entry for other providers.",
    },
    {
      key: "opencodeAgent",
      label: "Agent",
      kind: "text",
      placeholder: "Default",
    },
    {
      key: "opencodeBaseUrl",
      label: "Custom Base URL",
      kind: "text",
      placeholder: "https://your-inference-server/v1",
      helpText:
        "OpenAI-compatible endpoint URL. When set, API keys are optional — a placeholder key is used if none is configured in Secrets.",
    },
  ],
  liveRefreshSupported: false,
};
