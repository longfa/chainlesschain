import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  sessionPath,
  startSession,
} from "../../src/harness/jsonl-session-store.js";
import { runAgentHeadless } from "../helpers/test-model-egress.js";

it.runIf(process.platform === "win32")(
  "reports a real read-only transcript write failure before calling the model",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-headless-readonly-session-"));
    const cwd = join(root, "workspace");
    const home = join(root, "user-home");
    mkdirSync(cwd);
    mkdirSync(home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("APPDATA", join(root, "appdata"));
    vi.stubEnv("CHAINLESSCHAIN_HOME", join(root, "config"));
    vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", join(root, "security"));
    const sessionId = "readonly-fixture";
    let transcript;
    try {
      startSession(sessionId, { provider: "mock", model: "fixture" });
      transcript = sessionPath(sessionId);
      const before = readFileSync(transcript);
      const chat = vi.fn();
      const output = [];
      const outcome = await runAgentHeadless(
        {
          cwd,
          prompt: "this message must not be written",
          outputFormat: "json",
          resume: sessionId,
          provider: "mock",
          model: "fixture",
          chatFn: chat,
          runnableProviderFallback: false,
          expandFileRefs: false,
          slashMacros: false,
        },
        {
          bootstrap: async () => {
            // Change the actual Windows file attribute after canonical admission.
            chmodSync(transcript, 0o444);
            return { db: null };
          },
          resolveAgentMcp: async () => null,
          getApprovalGate: async () => null,
          writeOut: (text) => output.push(text),
          writeErr: () => {},
        },
      );
      expect(outcome).toMatchObject({ exitCode: 1, isError: true });
      const result = JSON.parse(output.join(""));
      expect(result, JSON.stringify(result)).toMatchObject({
        is_error: true,
        persistence: {
          phase: "before-model",
          fs_code: expect.stringMatching(/^(EPERM|EACCES|EROFS)$/u),
        },
      });
      expect(chat).not.toHaveBeenCalled();
      expect(readFileSync(transcript).equals(before)).toBe(true);
    } finally {
      if (transcript) chmodSync(transcript, 0o600);
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
