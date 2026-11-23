import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { CLI_BIN, testHome } from "./_helpers/cli-e2e.js";

const run = promisify(execFile);
const schema = '{"type":"object","required":["complete"]}';

it.each([
  { mode: "JSON", format: "json", flags: [] },
  { mode: "unattended JSON", format: "json", flags: ["--unattended"] },
  {
    mode: "stream-JSON with a valid response schema",
    format: "stream-json",
    flags: ["--json-schema", schema],
  },
  {
    mode: "duplex stream-JSON followed by a safe turn",
    format: "stream-json",
    flags: ["--json-schema", schema, "--unattended"],
    duplex: true,
  },
])(
  "fails an unapproved home delete in $mode",
  async ({ format, flags, duplex }) => {
    const t = testHome("headless-delete");
    const marker = join(t.userHome, "keep.txt");
    writeFileSync(marker, "intact");
    const command = `rm -rf "${t.userHome.replaceAll("\\", "/")}"`;
    const toolCall = {
      id: "delete-fixture-home",
      type: "function",
      function: { name: "run_shell", arguments: JSON.stringify({ command }) },
    };
    let modelCalls = 0;
    const server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          Connection: "close",
        });
        res.end(
          JSON.stringify({
            message:
              ++modelCalls === 1
                ? { role: "assistant", content: "", tool_calls: [toolCall] }
                : { role: "assistant", content: '{"complete":true}' },
            done: true,
            prompt_eval_count: 4,
            eval_count: 2,
          }),
        );
      });
    });
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const call = run(
        process.execPath,
        [
          CLI_BIN,
          "agent",
          ...(duplex
            ? ["--input-format", "stream-json"]
            : ["-p", "Check the fixture operation"]),
          "--provider",
          "ollama",
          "--model",
          "test",
          "--base-url",
          `http://127.0.0.1:${server.address().port}`,
          "--output-format",
          format,
          "--sandbox-mode",
          "off",
          "--ephemeral",
          "--bare",
          "--no-mcp",
          ...flags,
        ],
        {
          cwd: t.workspace,
          env: t.env({ APPDATA: t.configHome, XDG_CONFIG_HOME: t.configHome }),
          timeout: 90_000,
        },
      );
      if (duplex) {
        call.child.stdin.end(
          ["Check the fixture operation", "Report the current status"]
            .map((text) => JSON.stringify({ type: "user", text }))
            .join("\n") + "\n",
        );
      }
      const result = await call.catch((error) => error);

      expect(readFileSync(marker, "utf8")).toBe("intact");
      expect(result.stdout, result.stderr).not.toBe("");
      const events = result.stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      const outcomes = events.filter((event) => event.type === "result");
      const outcome = outcomes[0];
      expect(outcomes).toHaveLength(duplex ? 2 : 1);
      if (duplex) {
        expect(outcomes[1]).toMatchObject({
          is_error: false,
          subtype: "success",
        });
        const verdicts = events.filter(
          (event) => event.type === "structured_result",
        );
        expect(verdicts).toMatchObject([
          { turn: outcomes[1].turn, valid: true },
        ]);
      }
      const denials =
        outcome.denials ||
        events.find((event) => event.type === "denials_summary")?.denials;
      expect(denials).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tool: "run_shell",
            rule: "dangerous-delete",
            reason: expect.stringMatching(/destructive delete/i),
          }),
        ]),
      );
      expect(outcome).toMatchObject({
        is_error: true,
        code: "CC_DESTRUCTIVE_SHELL_DENIED",
      });
      expect(result.code).toBe(1);
      const saved = JSON.parse(
        readFileSync(join(t.configHome, "recent-denials.json"), "utf8"),
      );
      expect(saved.denials).toEqual([
        expect.objectContaining({
          tool: "run_shell",
          rule: "dangerous-delete",
          source: "headless",
        }),
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      t.cleanup();
    }
  },
);
