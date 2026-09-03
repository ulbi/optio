import { describe, it, expect } from "vitest";
import { OPENCODE_CATALOG } from "./opencode.js";

describe("OPENCODE_CATALOG", () => {
  it("includes opencodeProvider option as free-text field", () => {
    const providerOption = OPENCODE_CATALOG.options.find((o) => o.key === "opencodeProvider");
    expect(providerOption).toBeDefined();
    expect(providerOption?.kind).toBe("text");
    expect(providerOption?.placeholder).toBe("anthropic");
    expect(providerOption?.helpText).toContain("litellm");
  });

  it("accepts common provider values in opencodeProvider helpText", () => {
    const providerOption = OPENCODE_CATALOG.options.find((o) => o.key === "opencodeProvider");
    expect(providerOption?.helpText).toContain("anthropic");
    expect(providerOption?.helpText).toContain("openai");
    expect(providerOption?.helpText).toContain("groq");
    expect(providerOption?.helpText).toContain("litellm");
    expect(providerOption?.helpText).toContain("custom");
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