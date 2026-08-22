# Plan: Cursor LiteLLM Proxy Support in Optio

This document outlines the proposed changes to enable Cursor to work via a LiteLLM Proxy in Optio.

## Important Note

**Cursor CLI (`cursor-agent`) does not natively support custom OpenAI-compatible endpoints.** It communicates directly with Cursor's backend services using a `CURSOR_API_KEY`. The models available are tied to the user's Cursor account/plan and are queried via `cursor-agent models`.

To use LiteLLM Proxy with Cursor, you would need:
1. **Cursor to add support for custom endpoints** (not available as of 2024/2025)
2. **A custom Cursor-compatible proxy** that translates between Cursor protocol and OpenAI-compatible API

## Assessment

After reviewing the Cursor adapter and CLI behavior:

- Cursor CLI uses `CURSOR_API_KEY` for authentication
- It talks to Cursor's proprietary backend (not OpenAI-compatible)
- Model selection is done via `cursor-agent --model <model>` where models are account-specific
- No environment variable like `OPENAI_BASE_URL` or `CURSOR_BASE_URL` is respected
- The CLI does not report token usage or cost — billing happens on the Cursor account

## Conclusion

**Direct LiteLLM Proxy support for Cursor is NOT FEASIBLE** without:
- Cursor adding support for custom endpoints (not available)
- A custom Cursor-to-OpenAI proxy (significant development effort, reverse-engineering required)

## Alternative: Use OpenCode or Claude Code with Same Models

If you want to use the same models available in Cursor (GPT-4o, Claude Sonnet, etc.) via LiteLLM:
1. Configure LiteLLM Proxy with the same models
2. Use **OpenCode** agent with `opencodeBaseUrl` pointing to LiteLLM
3. Select models like `openai/gpt-4o`, `anthropic/claude-sonnet-4` in OpenCode
4. Or use **Claude Code** with `claudeCodeBaseUrl` pointing to LiteLLM

## Recommended Approach

**Do NOT implement LiteLLM for Cursor.** Instead:
1. Document that Cursor doesn't support custom endpoints
2. Guide users to OpenCode or Claude Code for LiteLLM Proxy usage
3. Both support the same model identifiers

---

## If You Still Want to Attempt It (Not Recommended)

Theoretical approach would require:

1. **Custom Cursor Proxy** - A service that:
   - Accepts Cursor CLI protocol (`cursor-agent` protocol)
   - Translates to OpenAI-compatible API calls
   - Forwards to LiteLLM Proxy
   - Translates responses back to Cursor protocol

2. **Schema Changes** - Add `cursorProxyUrl` to repos table

3. **Adapter Changes** - Inject proxy config, but Cursor CLI has no config for this

This is a significant separate project and outside the scope of simple LiteLLM integration. The Cursor protocol is not publicly documented.

---

## Summary

| Approach | Feasibility | Effort | Recommendation |
|----------|-------------|--------|----------------|
| Native Cursor + LiteLLM | ❌ Not supported by Cursor | N/A | Don't attempt |
| Custom Cursor→OpenAI Proxy | ⚠️ Theoretically possible | Very High (months) | Separate project |
| **Use OpenCode instead** | ✅ Works today | Low | **Recommended** |
| **Use Claude Code instead** | ✅ Works today | Low | **Recommended** |

**Recommendation**: Close this plan. Use OpenCode or Claude Code with LiteLLM Proxy for OpenAI/Anthropic models.