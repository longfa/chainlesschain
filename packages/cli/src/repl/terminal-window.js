import { EventEmitter } from "node:events";
import { stripVTControlCharacters } from "node:util";
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_LEAVE,
  diffRepaint,
  HIDE_CURSOR,
  SHOW_CURSOR,
} from "./fullscreen-tui.js";

const MAX_TRANSCRIPT_LINES = 2000;
const MAX_LINE_LENGTH = 16000;
const FRAME_INTERVAL_MS = 24;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function isStandaloneEscape(key) {
  // Node readline sets meta for a lone Esc after the escape-sequence timeout.
  return key.name === "escape" && (!key.meta || key.sequence === "\x1b");
}

function terminalText(value) {
  return stripVTControlCharacters(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/\p{Cc}/gu, (character) => (character === "\n" ? character : ""));
}

function wrapLine(text, columns, widthOf) {
  const rows = [""];
  let col = 0;
  for (const { segment } of graphemes.segment(text)) {
    const width =
      segment.length === 1 && segment.charCodeAt(0) < 127
        ? 1
        : widthOf(segment);
    if (col + width > columns) {
      rows.push("");
      col = 0;
    }
    rows[rows.length - 1] += segment;
    col += width;
  }
  return { rows, col };
}

export function createTerminalWindow({
  input,
  stdout,
  stderr,
  waitForOutput,
  getStatus,
  getSlashSuggestions,
  isQuestionActive = () => false,
}) {
  let rl;
  let active = false;
  let frameTimer;
  let blocked = false;
  let painted = [];
  let offset = 0;
  let wrappedColumns;
  let cursorPosition = "";
  let slashQuery = "";
  let slashSelection = 0;
  let picker = null;
  const transcript = [{ text: "" }];
  const writeTerminal = stdout.write.bind(stdout);
  const writeError = stderr.write;
  const writeOutput = stdout.write;

  function schedule() {
    if (!active || blocked || frameTimer) return;
    frameTimer = setTimeout(render, FRAME_INTERVAL_MS);
  }

  function append(value) {
    const parts = terminalText(value).split("\n");
    const last = transcript.pop();
    transcript.push({ text: (last.text + parts[0]).slice(-MAX_LINE_LENGTH) });
    for (let i = 1; i < parts.length; i++) {
      transcript.push({ text: parts[i].slice(-MAX_LINE_LENGTH) });
    }
    if (transcript.length > MAX_TRANSCRIPT_LINES)
      transcript.splice(0, transcript.length - MAX_TRANSCRIPT_LINES);
    schedule();
  }

  function capture(chunk, encoding, callback) {
    append(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    const done = typeof encoding === "function" ? encoding : callback;
    if (done) queueMicrotask(() => done());
    return true;
  }

  const readlineOutput = new EventEmitter();
  Object.defineProperties(readlineOutput, {
    columns: { get: () => stdout.columns },
    rows: { get: () => stdout.rows },
    isTTY: { get: () => stdout.isTTY },
  });
  readlineOutput.write = (value, ...args) => {
    if (!active) return writeTerminal(value, ...args);
    // readline draws its own prompt and emits cursor controls. Its completion
    // listing is regular output, which belongs in the transcript.
    if (value === "\x07") return writeTerminal(value);
    if (
      value.includes("\n") &&
      value !== rl.getPrompt() + rl.line &&
      terminalText(value).trim()
    )
      append(value);
    schedule();
    return true;
  };

  function render() {
    frameTimer = undefined;
    if (!active) return;
    const rows = Math.max(2, stdout.rows || 24);
    const columns = Math.max(2, (stdout.columns || 80) - 1);
    if (wrappedColumns !== columns) {
      for (const line of transcript) delete line.wrapped;
      wrappedColumns = columns;
    }
    const widthOf = (value) => {
      const size = rl._getDisplayPos(value);
      return size.cols + size.rows * (stdout.columns || 80);
    };
    const wrap = (value) => wrapLine(value, columns, widthOf);
    const wrapInput = (value) => value.split("\n").map(wrap);
    const prompt = terminalText(rl.getPrompt());
    const inputRows = wrapInput(prompt + terminalText(rl.line)).flatMap(
      (line) => line.rows,
    );
    const cursor = wrapInput(
      prompt + terminalText(rl.line.slice(0, rl.cursor)),
    );
    const cursorRow = cursor.reduce((n, line) => n + line.rows.length, 0) - 1;
    const inputHeight = Math.min(
      inputRows.length,
      Math.max(1, Math.min(5, rows - 3)),
    );
    const inputStart = Math.max(0, cursorRow - inputHeight + 1);
    const visiblePicker = picker && !isQuestionActive() ? picker : null;
    const suggestions = visiblePicker
      ? pickerMatches()
      : currentSlashSuggestions();
    const selection = visiblePicker ? visiblePicker.index : slashSelection;
    const pickerTitle = visiblePicker
      ? wrap(
          visiblePicker.query
            ? `${visiblePicker.title} · Filter ${visiblePicker.query}${suggestions.length ? "" : " · No matches"}`
            : `${visiblePicker.title} · ↑↓ Select · Enter Apply · Esc Close`,
        ).rows[0]
      : null;
    const menuHeight = Math.min(
      5,
      Math.max(0, rows - inputHeight - (pickerTitle ? 4 : 3)),
      suggestions.length,
    );
    const menuStart = Math.max(0, selection - menuHeight + 1);
    const footer = [
      "",
      ...inputRows.slice(inputStart, inputStart + inputHeight),
    ];
    if (pickerTitle && rows > footer.length) footer.push(pickerTitle);
    for (let i = menuStart; i < menuStart + menuHeight; i++) {
      const choice = suggestions[i];
      const label = wrap(
        terminalText(
          `${i === selection ? "›" : " "} ${choice}${visiblePicker?.current === choice ? " (current)" : ""}`,
        ),
      ).rows[0];
      footer.push(i === selection ? `\x1b[7m${label}\x1b[0m` : label);
    }
    const capacity = Math.max(0, rows - footer.length);
    const recent = [];
    if (offset > 0) {
      let total = 0;
      for (const line of transcript) {
        if (line === transcript.at(-1) && !line.text) break;
        line.wrapped ??= wrap(line.text).rows;
        total += line.wrapped.length;
      }
      offset = Math.min(offset, Math.max(0, total - capacity));
    }
    const range = offset ? "  ·  PgDn for newer output" : "";
    footer[0] = wrap(getStatus() + range).rows[0];
    let skip = offset;
    for (
      let i = transcript.length - 1;
      i >= 0 && recent.length < capacity;
      i--
    ) {
      const line = transcript[i];
      if (i === transcript.length - 1 && !line.text) continue;
      line.wrapped ??= wrap(line.text).rows;
      for (
        let j = line.wrapped.length - 1;
        j >= 0 && recent.length < capacity;
        j--
      ) {
        if (skip > 0) skip--;
        else recent.push(line.wrapped[j]);
      }
    }
    const next = [
      ...recent.reverse(),
      ...Array(capacity - recent.length).fill(""),
      ...footer,
    ];
    const position = `\x1b[${capacity + 2 + cursorRow - inputStart};${cursor.at(-1).col + 1}H`;
    const update = diffRepaint(painted.slice(0, rows), next);
    if (!update && cursorPosition === position) return;
    painted = next;
    cursorPosition = position;
    if (!writeTerminal(HIDE_CURSOR + update + position + SHOW_CURSOR)) {
      blocked = true;
      void waitForOutput().finally(() => {
        blocked = false;
        schedule();
      });
    }
  }

  function currentSlashSuggestions() {
    const suggestions = getSlashSuggestions(rl.line);
    if (slashQuery !== rl.line) {
      slashQuery = rl.line;
      slashSelection = Math.max(0, suggestions.indexOf(rl.line));
    }
    slashSelection = Math.min(
      slashSelection,
      Math.max(0, suggestions.length - 1),
    );
    return suggestions;
  }

  function pickerMatches() {
    const query = picker.query.toLowerCase();
    return picker.choices.filter((choice) =>
      choice.toLowerCase().includes(query),
    );
  }

  const refreshSize = () => {
    painted = [];
    cursorPosition = "";
    readlineOutput.emit("resize");
    schedule();
  };

  function disable() {
    if (!active) return;
    active = false;
    clearTimeout(frameTimer);
    frameTimer = undefined;
    input.off("keypress", schedule);
    stdout.write = writeOutput;
    if (stderr.write === capture) stderr.write = writeError;
    rl.prevRows = 0;
    writeTerminal(SHOW_CURSOR + ALT_SCREEN_LEAVE);
  }

  return {
    readlineOutput,
    bind(readline) {
      rl = readline;
      stdout.on("resize", refreshSize);
    },
    schedule,
    append,
    follow() {
      offset = 0;
      schedule();
    },
    showPicker({ title, choices, selected, current = selected, onSelect }) {
      picker = {
        title,
        choices,
        current,
        onSelect,
        index: Math.max(0, choices.indexOf(selected)),
        query: "",
      };
      schedule();
    },
    handlePickerKey(text, key) {
      if (!active || !picker || isQuestionActive()) return false;
      if (key.ctrl && key.name === "c") return false;
      if (isStandaloneEscape(key)) {
        picker = null;
        schedule();
        return true;
      }
      if (key.ctrl || key.meta) return true;
      const matches = pickerMatches();
      if (key.name === "up" || key.name === "down") {
        const delta = key.name === "up" ? -1 : 1;
        if (matches.length)
          picker.index =
            (picker.index + delta + matches.length) % matches.length;
      } else if (key.name === "return" || key.name === "enter") {
        const choice = matches[picker.index];
        if (choice) {
          const { onSelect } = picker;
          picker = null;
          onSelect(choice);
        }
      } else if (key.name === "backspace") {
        picker.query = Array.from(picker.query).slice(0, -1).join("");
        picker.index = 0;
      } else if (text && !/\p{Cc}/u.test(text)) {
        picker.query = (picker.query + text).slice(0, 256);
        picker.index = 0;
      }
      schedule();
      return true;
    },
    handleSlashKey(key) {
      if (!active || key.ctrl || key.meta || key.shift) return false;
      if (!["up", "down", "tab", "return", "enter"].includes(key.name))
        return false;
      const suggestions = currentSlashSuggestions();
      if (suggestions.length === 0) return false;
      if (key.name === "up" || key.name === "down") {
        const delta = key.name === "up" ? -1 : 1;
        slashSelection =
          (slashSelection + delta + suggestions.length) % suggestions.length;
        schedule();
        return true;
      }
      rl.line = suggestions[slashSelection] + (key.name === "tab" ? " " : "");
      rl.cursor = rl.line.length;
      schedule();
      return key.name === "tab";
    },
    scroll(delta) {
      offset = Math.max(
        0,
        offset + delta * Math.max(1, (stdout.rows || 24) - 5),
      );
      schedule();
    },
    enable() {
      if (active) return;
      active = true;
      painted = [];
      cursorPosition = "";
      writeTerminal(ALT_SCREEN_ENTER);
      stdout.write = capture;
      if (stderr.isTTY) stderr.write = capture;
      input.on("keypress", schedule);
      schedule();
    },
    disable,
    dispose() {
      picker = null;
      disable();
      stdout.off("resize", refreshSize);
    },
  };
}
