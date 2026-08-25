import type { ProviderCatalog } from "./types.js";

export const OPencodeMODES = ["plan", "review", "code", "chat", "quick", "lint", "small"] as const;

export type OpencodeProvider =
  | "native"
  | "litellm"
  | "openai-compatible"
  | "anthropic"
  | "openai"
  | "groq"
  | "google"
  | "mistral"
  | "cohere";

export const OPencodePROVIDER_CHOICES: Array<{
  value: OpencodeProvider;
  label: string;
  hint?: string;
}> = [
  {
    value: "native",
    label: "Native (default)",
    hint: "OpenCode uses its built-in provider selection",
  },
  { value: "litellm", label: "LiteLLM Proxy", hint: "Route through LiteLLM proxy server" },
  {
    value: "openai-compatible",
    label: "OpenAI-Compatible",
    hint: "Self-hosted inference server (vLLM, Ollama, etc.)",
  },
  { value: "anthropic", label: "Anthropic (legacy)", hint: "Native Anthropic API" },
  { value: "openai", label: "OpenAI (legacy)", hint: "Native OpenAI API" },
  { value: "groq", label: "Groq (legacy)", hint: "Native Groq API" },
  { value: "google", label: "Google (legacy)", hint: "Native Google AI API" },
  { value: "mistral", label: "Mistral (legacy)", hint: "Native Mistral API" },
  { value: "cohere", label: "Cohere (legacy)", hint: "Native Cohere API" },
];

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
      choices: OPencodePROVIDER_CHOICES.map((c) => ({ value: c.value, label: c.label })),
      default: "native",
      helpText:
        "Select the inference provider. 'litellm' and 'openai-compatible' require custom base URL.",
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
    {
      key: "opencodeModeModels",
      label: "Mode Models",
      kind: "modeModels",
      modes: OPencodeMODES,
      default: {},
      helpText: "Set models for each OpenCode mode. These are provider-independent.",
    },
  ],
  liveRefreshSupported: false,
};
