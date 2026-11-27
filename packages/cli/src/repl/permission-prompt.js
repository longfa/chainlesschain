/**
 * Build the header line for the REPL's interactive permission prompt.
 *
 * The confirmer is shared by three callers that pass different shapes:
 *   - settings `ask` rules / hook `ask`  → `rule` is set (e.g. "Bash", "hook:…")
 *   - the destructive-git guard           → `reason` is set, `rule` is null
 *   - the sensitive-file-write guard      → `reason` is set, `rule` is null
 * The previous template interpolated `${rule}` unconditionally, so the
 * rule-less guards rendered a literal "null" in the prompt. This picks the
 * right phrasing for each case.
 *
 * Pure + side-effect-free so it is unit-testable (the interactive confirmer
 * closure that consumes it cannot be driven over piped stdin).
 *
 * @returns {string} the prompt header (no styling, no trailing "Proceed?")
 */
import { normalizePermissionRequest } from "../lib/permission-request.js";
import { redactSecrets } from "../lib/secret-scan.js";

export function visualizePermissionText(value) {
  return String(value ?? "").replace(
    // eslint-disable-next-line no-misleading-character-class -- Match each invisible character on its own.
    /[\p{Cc}\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/gu,
    (character) => {
      if (character === "\t") return "<TAB>";
      if (character === "\n") return "<LF>";
      if (character === "\r") return "<CR>";
      return `<U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}>`;
    },
  );
}

export function buildPermissionPrompt({ tool, args, rule, reason } = {}) {
  const request = normalizePermissionRequest({ tool, args });
  const visibleTool = visualizePermissionText(request.tool);
  const rawDetail = request.detail;
  const visibleDetail = visualizePermissionText(redactSecrets(rawDetail));
  const detail = rawDetail ? ` ${visibleDetail}` : "";
  if (rule) {
    return `[Permission] rule "${visualizePermissionText(redactSecrets(String(rule)))}" asks before ${visibleTool}:${detail}`;
  }
  if (reason) {
    const reasonText = String(reason);
    const missingTarget = rawDetail && !reasonText.includes(String(rawDetail));
    return `[Permission] ${visualizePermissionText(redactSecrets(reasonText))}${missingTarget ? `:${detail}` : ""}`;
  }
  return `[Permission] confirm ${visibleTool}:${detail}`;
}

/**
 * Resolve the idle timeout (ms) for interactive permission prompts.
 *
 * An unanswered prompt blocks the whole agent turn forever (e.g. the user
 * walked away mid-run). With a timeout configured, the prompt auto-denies
 * after `ms` of silence — deny is the only safe unattended answer.
 *
 * Precedence: CC_PERMISSION_ASK_TIMEOUT_MS env > config
 * `permissions.askTimeoutMs` > default 0 (disabled — waits forever, the
 * historical behavior). Non-finite / non-positive values disable it.
 *
 * @param {{env?: string, config?: unknown}} [opts] - injectable for tests
 * @returns {number} timeout in ms, 0 = disabled
 */
export function resolveAskIdleTimeoutMs({ env, config } = {}) {
  const envRaw =
    env !== undefined ? env : process.env.CC_PERMISSION_ASK_TIMEOUT_MS;
  const candidate =
    envRaw !== undefined && envRaw !== null && envRaw !== ""
      ? Number(envRaw)
      : typeof config === "number" || typeof config === "string"
        ? Number(config)
        : NaN; // booleans/objects are not a timeout — disabled
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

/**
 * Race an interactive question against an idle timeout.
 *
 * `ask` is the readline question as a promise. On timeout the caller cancels
 * the question so the input can return to the conversation.
 *
 * @param {(prompt: string) => Promise<string|null>} ask
 * @param {string} prompt
 * @param {number} timeoutMs - 0/negative = no timeout (plain await)
 * @returns {Promise<{answer: string|null, timedOut: boolean}>}
 */
export async function questionWithIdleTimeout(ask, prompt, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { answer: await ask(prompt), timedOut: false };
  }
  let timer = null;
  try {
    return await Promise.race([
      ask(prompt).then((answer) => ({ answer, timedOut: false })),
      new Promise((res) => {
        timer = setTimeout(
          () => res({ answer: null, timedOut: true }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Ask through the same readline queue as approvals and the fullscreen composer. */
export async function askReplUser(
  questionQueue,
  { question, options, multiSelect, timeoutMs },
  signal,
) {
  signal?.throwIfAborted();
  const choices = Array.isArray(options)
    ? options
        .filter((option) => typeof option === "string" && option.trim())
        .slice(0, 100)
    : [];
  const visible = (value) =>
    visualizePermissionText(redactSecrets(value)).slice(0, 500);
  const details = choices.map(
    (option, index) => `  ${index + 1}. ${visible(option)}`,
  );
  const selection = choices.length
    ? multiSelect
      ? "Choose numbers separated by commas"
      : "Choose a number"
    : "Answer";
  const prompt = [
    `  ${visible(question)}`,
    ...details,
    `  ${selection}> `,
  ].join("\n");
  const pending = questionQueue.create();
  const cancel = () => pending.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const { answer, timedOut } = await questionWithIdleTimeout(
      pending.ask,
      prompt,
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.min(timeoutMs, 900_000)
        : 60_000,
    );
    if (timedOut) {
      throw Object.assign(new Error("Question timed out"), {
        code: "USER_TIMEOUT",
      });
    }
    const text = answer?.trim();
    if (text && !choices.length) return text;
    if (text && choices.length) {
      const numbers = (multiSelect ? text.split(",") : [text]).map((part) =>
        part.trim(),
      );
      if (
        numbers.every(
          (part) =>
            /^[1-9][0-9]*$/u.test(part) && Number(part) <= choices.length,
        )
      ) {
        const selected = [
          ...new Set(numbers.map((part) => choices[Number(part) - 1])),
        ];
        return multiSelect ? selected : selected[0];
      }
    }
    throw Object.assign(new Error("Question cancelled or selection invalid"), {
      code: "USER_REJECTED",
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancel();
  }
}

// All terminal questions share readline with the composer. Suspending the
// draft keeps an approval response separate from the next user message.
export function createReplQuestionQueue(readline, write, display = {}) {
  let tail = Promise.resolve();
  let current = null;
  let closed = false;
  readline.once("close", () => {
    closed = true;
    current?.abort();
  });

  return {
    isActive: () => current !== null,
    cancelActive: () => current?.abort(),
    create() {
      const controller = new AbortController();
      const { signal } = controller;
      return {
        get canceled() {
          return signal.aborted;
        },
        cancel: () => controller.abort(),
        ask(text) {
          const answer = tail.then(() => {
            if (closed || signal.aborted) return null;
            return new Promise((resolve) => {
              current = controller;
              const { line, cursor } = readline;
              readline.line = "";
              readline.cursor = 0;
              const split = text.lastIndexOf("\n") + 1;
              const detailsShown =
                split && display.showDetails?.(text.slice(0, split));
              if (split && !detailsShown) write(text.slice(0, split));
              const finish = (value) => {
                signal.removeEventListener("abort", onAbort);
                current = null;
                if (detailsShown) display.clearDetails?.();
                if (!closed) {
                  readline.line = line;
                  readline.cursor = cursor;
                  readline.prompt(true);
                }
                resolve(value);
              };
              // Let readline cancel its callback and restore its prompt
              // before putting the draft back.
              const onAbort = () => queueMicrotask(() => finish(null));
              signal.addEventListener("abort", onAbort, { once: true });
              readline.question(text.slice(split), { signal }, finish);
            });
          });
          tail = answer;
          return answer;
        },
      };
    },
  };
}
