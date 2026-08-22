# Plan: GitHub Copilot LiteLLM Proxy Support in Optio

This document outlines the proposed changes to enable GitHub Copilot to work via a LiteLLM Proxy in Optio.

## Important Note

**GitHub Copilot CLI does not natively support custom OpenAI-compatible endpoints.** It communicates directly with GitHub's Copilot service using a GitHub token (`COPILOT_GITHUB_TOKEN`). 

To use LiteLLM Proxy with Copilot, you would need to either:
1. **Run a Copilot-compatible proxy** that translates between Copilot protocol and OpenAI-compatible API (doesn't exist widely)
2. **Use a different agent** (OpenCode, Claude Code, Codex) which natively support custom endpoints

## Assessment

After reviewing the Copilot adapter and CLI behavior:

- Copilot CLI uses `COPILOT_GITHUB_TOKEN` for authentication
- It talks to `api.github.com` / `api.individual.github.com` directly
- No environment variable like `OPENAI_BASE_URL` or `COPILOT_BASE_URL` is respected
- The model selection is done server-side by GitHub

## Conclusion

**Direct LiteLLM Proxy support for GitHub Copilot is NOT FEASIBLE** without:
- A custom Copilot-to-OpenAI proxy (significant development effort)
- Or GitHub adding support for custom endpoints (not available)

## Alternative: Use OpenCode with Copilot Models

If you want to use Copilot's model selection (GPT-4o, Claude Sonnet, etc.) via LiteLLM:
1. Configure LiteLLM Proxy with the same models
2. Use **OpenCode** agent with `opencodeBaseUrl` pointing to LiteLLM
3. Select models like `openai/gpt-4o`, `anthropic/claude-sonnet-4` in OpenCode

## Recommended Approach

**Do NOT implement LiteLLM for Copilot.** Instead:
1. Document that Copilot doesn't support custom endpoints
2. Guide users to OpenCode for LiteLLM Proxy usage
3. OpenCode supports the same model identifiers (`openai/gpt-4o`, `anthropic/claude-sonnet-4`, etc.)

---

## If You Still Want to Attempt It (Not Recommended)

Theoretical approach would require:

1. **Custom Copilot Proxy** - A service that:
   - Accepts Copilot CLI protocol
   - Translates to OpenAI-compatible API calls
   - Forwards to LiteLLM Proxy
   - Translates responses back

2. **Schema Changes** - Add `copilotProxyUrl` to repos table

3. **Adapter Changes** - Inject proxy config, but Copilot CLI has no config for this

This is a significant separate project and outside the scope of simple LiteLLM integration.

---

## Summary

| Approach | Feasibility | Effort | Recommendation |
|----------|-------------|--------|----------------|
| Native Copilot + LiteLLM | ❌ Not supported by GitHub | N/A | Don't attempt |
| Custom Copilot→OpenAI Proxy | ⚠️ Theoretically possible | High (weeks) | Separate project |
| **Use OpenCode instead** | ✅ Works today | Low | **Recommended** |

**Recommendation**: Close this plan. Use OpenCode with LiteLLM Proxy for OpenAI/Anthropic models.