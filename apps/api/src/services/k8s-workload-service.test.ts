import { afterEach, describe, expect, it } from "vitest";
import type { ContainerSpec } from "@optio/shared";
import {
  K8sWorkloadManager,
  WORKLOAD_ALLOWED_CAPABILITIES,
  validateWorkloadCapabilities,
} from "./k8s-workload-service.js";

function baseSpec(overrides: Partial<ContainerSpec> = {}): ContainerSpec {
  return {
    image: "optio-agent:latest",
    command: ["/opt/optio/repo-init.sh"],
    env: {},
    workDir: "/workspace",
    labels: { "optio.type": "repo-pod" },
    ...overrides,
  };
}

function buildTemplate(spec: ContainerSpec, restartPolicy: "Always" | "Never" = "Always") {
  const manager = Object.create(K8sWorkloadManager.prototype) as {
    buildPodTemplate: (
      spec: ContainerSpec,
      instanceName: string,
      restartPolicy: "Always" | "Never",
    ) => unknown;
  };
  return manager.buildPodTemplate(spec, "repo-abc", restartPolicy) as any;
}

describe("K8sWorkloadManager security context", () => {
  it("drops capabilities and disables privilege escalation by default", () => {
    const template = buildTemplate(baseSpec());
    const container = template.spec.containers[0];

    expect(container.securityContext.capabilities).toEqual({ drop: ["ALL"] });
    expect(container.securityContext.allowPrivilegeEscalation).toBe(false);
    expect(container.securityContext.seccompProfile).toEqual({ type: "RuntimeDefault" });
  });

  it("allows only capabilities from the workload allowlist", () => {
    const template = buildTemplate(baseSpec({ capabilities: ["SYS_CHROOT"] }));
    const container = template.spec.containers[0];

    expect(container.securityContext.capabilities).toEqual({
      drop: ["ALL"],
      add: ["SYS_CHROOT"],
    });
  });

  it("rejects disallowed capabilities", () => {
    expect(() => buildTemplate(baseSpec({ capabilities: ["SYS_ADMIN"] }))).toThrow(
      "Disallowed container capabilities requested: SYS_ADMIN",
    );
  });

  it("keeps the workload allowlist aligned with Docker-in-Docker needs", () => {
    expect(WORKLOAD_ALLOWED_CAPABILITIES.has("SYS_CHROOT")).toBe(true);
    expect(WORKLOAD_ALLOWED_CAPABILITIES.has("SYS_ADMIN")).toBe(false);
    expect(() => validateWorkloadCapabilities(["SYS_CHROOT"])).not.toThrow();
  });
});

describe("rootless mode (OPTIO_ROOTLESS, issue #532)", () => {
  afterEach(() => {
    delete process.env.OPTIO_ROOTLESS;
  });

  it("default mode keeps the root chown initContainer on StatefulSet pods", () => {
    const template = buildTemplate(baseSpec(), "Always");

    const initNames = (template.spec.initContainers ?? []).map((c: { name: string }) => c.name);
    expect(initNames).toContain("home-perm-fix");
    expect(template.spec.securityContext.runAsNonRoot).toBeUndefined();
    expect(template.spec.securityContext.fsGroupChangePolicy).toBeUndefined();
  });

  it("rootless mode omits the initContainer and hardens the pod security context", () => {
    process.env.OPTIO_ROOTLESS = "true";
    const template = buildTemplate(baseSpec(), "Always");

    const initNames = (template.spec.initContainers ?? []).map((c: { name: string }) => c.name);
    expect(initNames).not.toContain("home-perm-fix");
    expect(template.spec.securityContext).toMatchObject({
      fsGroup: 1001,
      runAsUser: 1001,
      runAsGroup: 1001,
      runAsNonRoot: true,
      fsGroupChangePolicy: "OnRootMismatch",
      seccompProfile: { type: "RuntimeDefault" },
    });
    // No root container remains anywhere in the pod
    for (const c of [...(template.spec.initContainers ?? []), ...template.spec.containers]) {
      expect(c.securityContext?.runAsUser).not.toBe(0);
    }
  });

  it("rootless mode still passes caller-supplied initContainers through", () => {
    process.env.OPTIO_ROOTLESS = "true";
    const template = buildTemplate(
      baseSpec({
        initContainers: [{ raw: { name: "custom-init", image: "busybox" } }],
      } as Partial<ContainerSpec>),
      "Always",
    );
    const initNames = (template.spec.initContainers ?? []).map((c: { name: string }) => c.name);
    expect(initNames).toEqual(["custom-init"]);
  });
});

describe("State 1: Secret injection into StatefulSet pod template", () => {
  it("buildPodTemplate includes provider API keys from spec.env in pod env array", () => {
    const spec = baseSpec({
      env: {
        OPTIO_TASK_ID: "task-123",
        OPTIO_REPO_URL: "https://github.com/org/repo",
        ANTHROPIC_API_KEY: "sk-ant-test-key",
        OPENAI_API_KEY: "sk-oai-test-key",
        GROQ_API_KEY: "sk-groq-test-key",
      },
    });
    const template = buildTemplate(spec, "Always");
    const env = template.spec.containers[0].env as Array<{ name: string; value: string }>;

    expect(env).toContainEqual({ name: "OPTIO_TASK_ID", value: "task-123" });
    expect(env).toContainEqual({ name: "ANTHROPIC_API_KEY", value: "sk-ant-test-key" });
    expect(env).toContainEqual({ name: "OPENAI_API_KEY", value: "sk-oai-test-key" });
    expect(env).toContainEqual({ name: "GROQ_API_KEY", value: "sk-groq-test-key" });
  });

  it("buildPodTemplate includes OPENCODE_MODEL for opencode agent", () => {
    const spec = baseSpec({
      env: {
        OPTIO_TASK_ID: "task-456",
        OPTIO_OPENCODE_MODEL: "claude-sonnet-4",
        ANTHROPIC_API_KEY: "sk-ant-claude-key",
      },
    });
    const template = buildTemplate(spec, "Always");
    const env = template.spec.containers[0].env as Array<{ name: string; value: string }>;

    expect(env).toContainEqual({ name: "OPTIO_OPENCODE_MODEL", value: "claude-sonnet-4" });
    expect(env).toContainEqual({ name: "ANTHROPIC_API_KEY", value: "sk-ant-claude-key" });
  });

  it("buildPodTemplate includes all OpenCode-related env vars from task-worker", () => {
    const spec = baseSpec({
      env: {
        OPTIO_TASK_ID: "task-789",
        OPTIO_REPO_URL: "https://github.com/org/another-repo",
        OPTIO_REPO_BRANCH: "main",
        OPTIO_PROMPT: "Fix this bug",
        OPTIO_AGENT_TYPE: "opencode",
        OPTIO_OPENCODE_MODEL: "gpt-4o",
        ANTHROPIC_API_KEY: "sk-ant-key",
        OPENAI_API_KEY: "sk-oai-key",
      },
    });
    const template = buildTemplate(spec, "Always");
    const env = template.spec.containers[0].env as Array<{ name: string; value: string }>;

    const envMap = Object.fromEntries(env.map((e) => [e.name, e.value]));
    expect(envMap["OPTIO_TASK_ID"]).toBe("task-789");
    expect(envMap["OPTIO_OPENCODE_MODEL"]).toBe("gpt-4o");
    expect(envMap["ANTHROPIC_API_KEY"]).toBe("sk-ant-key");
    expect(envMap["OPENAI_API_KEY"]).toBe("sk-oai-key");
  });

  it("buildPodTemplate does not include secrets when env is empty", () => {
    const spec = baseSpec({
      env: {
        OPTIO_TASK_ID: "task-no-secrets",
        OPTIO_PROMPT: "Test task",
      },
    });
    const template = buildTemplate(spec, "Always");
    const env = template.spec.containers[0].env as Array<{ name: string; value: string }>;

    expect(env).toContainEqual({ name: "OPTIO_TASK_ID", value: "task-no-secrets" });
    expect(env).not.toContainEqual(expect.objectContaining({ name: "ANTHROPIC_API_KEY" }));
    expect(env).not.toContainEqual(expect.objectContaining({ name: "OPENAI_API_KEY" }));
  });
});
