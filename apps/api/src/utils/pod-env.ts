/**
 * Helpers for injecting environment variables into agent pod exec scripts.
 *
 * Values (including the task prompt) are emitted as single-quoted `export`
 * statements embedded directly in the bash script. Single-quoted strings are
 * fully inert in bash — no command substitution, variable expansion, glob
 * expansion, or word splitting — and may span multiple lines, so prompt text
 * containing markdown backticks, `$VARS`, wildcards like `optio/task-*`, or
 * literal newlines round-trips exactly.
 *
 * The previous implementation piped base64-encoded JSON through python3 into
 * `eval $(...)`. Because the command substitution was unquoted, bash applied
 * word splitting and pathname expansion to the shlex-quoted output before
 * eval re-parsed it, which collapsed newlines in prompts to spaces and could
 * surface prompt fragments to the shell before the agent started.
 */

const VALID_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Escape a value as an inert single-quoted bash literal (`'\''` for embedded quotes). */
export function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Build `export KEY='value'` script lines for every env entry.
 * Throws on names bash would reject as identifiers — interpolating an
 * arbitrary name into `export <name>=` would otherwise allow injection.
 */
export function buildEnvExports(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => {
    if (!VALID_ENV_NAME.test(key)) {
      throw new Error(`Invalid environment variable name for pod exec: ${JSON.stringify(key)}`);
    }
    return `export ${key}=${shellSingleQuote(String(value))}`;
  });
}

/** Names of environment variables that contain secrets and should be masked in logs */
const SECRET_ENV_NAMES = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_VERTEX_SERVICE_ACCOUNT_KEY",
  "TOKEN",
]);

/** Mask secret values in an env record for safe logging */
export function maskSecrets(env: Record<string, string>): Record<string, string> {
  const masked = { ...env };
  for (const key of Object.keys(masked)) {
    if (SECRET_ENV_NAMES.has(key) || key.includes("API_KEY") || key.includes("TOKEN")) {
      masked[key] = masked[key].length > 4 ? "****" : "****";
    }
  }
  return masked;
}
