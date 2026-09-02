import { describe, it, expect } from "vitest";
import { OPENCODE_CATALOG } from "./opencode.js";

describe("OPENCODE_CATALOG", () => {
  it("includes opencodeProvider option with correct choices", () => {
    const providerOption = OPENCODE_CATALOG.options.find((o) => o.key === "opencodeProvider");
    expect(providerOption).toBeDefined();
    expect(providerOption?.kind).toBe("select");
    expect(providerOption?.choices).toBeDefined();
    expect(providerOption?.choices).toHaveLength(5);

    const choiceValues = providerOption?.choices?.map((c) => c.value);
    expect(choiceValues).toContain("anthropic");
    expect(choiceValues).toContain("openai");
    expect(choiceValues).toContain("groq");
    expect(choiceValues).toContain("litellm");
    expect(choiceValues).toContain("custom");
  });

  it("sets default provider to anthropic", () => {
    const providerOption = OPENCODE_CATALOG.options.find((o) => o.key === "opencodeProvider");
    expect(providerOption?.default).toBe("anthropic");
  });

  it("includes opencodeAgent and opencodeBaseUrl options unchanged", () => {
    const agentOption = OPENCODE_CATALOG.options.find((o) => o.key === "opencodeAgent");
    expect(agentOption).toBeDefined();
    expect(agentOption?.kind).toBe("text");

    const baseUrlOption = OPENCODE_CATALOG.options.find((o) => o.key === "opencodeBaseUrl");
    expect(baseUrlOption).toBeDefined();
    expect(baseUrlOption?.kind).toBe("text");
  });
});
