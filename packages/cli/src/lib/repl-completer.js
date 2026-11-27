/**
 * REPL `@` file-reference tab-completion (Claude-Code @-mention parity).
 *
 * Typing `@src/fo<TAB>` in the agent REPL completes file/dir paths the same
 * way the @-token will later be expanded by file-ref-expander. Two candidate
 * sources, merged:
 *   1. the filesystem under cwd (dirs get a trailing `/` so TAB can descend)
 *   2. the connected IDE's OPEN EDITOR TABS (when the IDE bridge is up) —
 *      the files you are working on rank first, before any fs listing.
 *
 * IDE tabs come from an injected async `getIdeOpenFiles()`; the completer
 * caches the last list (TTL) and refreshes in the background, so completion
 * stays synchronous-fast and a slow/dead IDE costs nothing (first TAB simply
 * has no IDE entries yet).
 */
import fs from "fs";
import path from "path";

/** Refresh the IDE open-editors list at most this often. */
const IDE_CACHE_TTL_MS = 5000;
/** Hard cap on candidates shown per TAB. */
const MAX_CANDIDATES = 30;

/**
 * Find a trailing `@token` being typed at the end of the line. Returns
 * `{ prefix }` (token without `@`, may be "") or null when the cursor is not
 * on an @-token. An @ must start the line or follow whitespace, mirroring
 * file-ref-expander's token rules.
 */
export function extractAtPrefix(line) {
  const m = /(^|\s)@([^\s@]*)$/.exec(line || "");
  return m ? { prefix: m[2] } : null;
}

/**
 * In `!` bash mode (the line starts with `!`), the trailing whitespace-delimited
 * token completes to a filesystem path (Claude-Code 2.1.193 bash-mode file
 * autocomplete). Returns `{ prefix }` — the token with any leading `!` stripped
 * (so `!cat src/fo` → `src/fo`, `!scr` → `scr`) — or null when not in bash mode.
 */
export function extractBashPathPrefix(line) {
  if (!/^\s*!/.test(line || "")) return null;
  const m = /(\S*)$/.exec(line || "");
  let tok = m ? m[1] : "";
  if (tok.startsWith("!")) tok = tok.slice(1); // `!src/fo` → `src/fo`
  return { prefix: tok };
}

export function readSlashArgument(text) {
  const value = text.trim();
  return /^(["'])(.*)\1$/u.exec(value)?.[2] ?? value;
}

/** Normalize to forward slashes (what @refs use on every platform). */
function fwd(p) {
  return String(p).replace(/\\/g, "/");
}

/**
 * Filesystem candidates for an @-prefix, relative to cwd. Directories get a
 * trailing `/`. Missing dirs / unreadable entries → empty (best-effort).
 */
export function fileCandidates(prefix, { cwd = process.cwd(), deps } = {}) {
  const readdir = deps?.readdir || ((d) => fs.readdirSync(d));
  const isDir =
    deps?.isDir ||
    ((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  const norm = fwd(prefix);
  const slash = norm.lastIndexOf("/");
  const dirPart = slash >= 0 ? norm.slice(0, slash + 1) : "";
  const basePart = slash >= 0 ? norm.slice(slash + 1) : norm;
  const absDir = path.resolve(cwd, dirPart || ".");
  let names;
  try {
    names = readdir(absDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (basePart && !name.toLowerCase().startsWith(basePart.toLowerCase())) {
      continue;
    }
    if (name === "node_modules" || name === ".git") continue;
    const rel = dirPart + name;
    out.push(isDir(path.join(absDir, name)) ? `${rel}/` : rel);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * Build a readline completer. Returns `completer(line)` → `[hits, replaced]`
 * per the readline contract. Completes `@path` tokens anywhere in the line
 * and registered `/command` names and arguments at line start.
 *
 * @param {object} opts { cwd?, getIdeOpenFiles?: () => Promise<string[]>,
 *                        slashCommands?: string[], getSlashArguments?, deps? }
 */
export function makeAtCompleter(opts = {}) {
  // Lazy when not pinned: `/cd` mid-session moves process.cwd() and the
  // completer must follow (explicit opts.cwd stays static for tests).
  const baseCwd = opts.cwd || null;
  const getCwd = () => baseCwd || process.cwd();
  const getIde = opts.getIdeOpenFiles || null;
  const now = opts.deps?.now || Date.now;
  let ideFiles = [];
  let ideFetchedAt = -Infinity; // "never" — the first @ must always fetch
  let ideInFlight = false;

  const refreshIde = () => {
    if (!getIde || ideInFlight || now() - ideFetchedAt < IDE_CACHE_TTL_MS) {
      return;
    }
    ideInFlight = true;
    Promise.resolve()
      .then(() => getIde())
      .then((files) => {
        ideFiles = Array.isArray(files)
          ? files
              .filter((f) => typeof f === "string" && f.length > 0)
              .map((f) => {
                const rel = path.relative(getCwd(), f);
                // Keep workspace files relative (the natural @ref form);
                // out-of-workspace files keep their absolute path. On
                // Windows a cross-drive relative() returns an *absolute*
                // path (no ".." prefix), so isAbsolute must also gate it.
                return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
                  ? fwd(rel)
                  : fwd(f);
              })
          : [];
        ideFetchedAt = now();
      })
      .catch(() => {
        ideFetchedAt = now(); // don't hammer a dead IDE
      })
      .finally(() => {
        ideInFlight = false;
      });
  };

  // De-duplicate before sorting so a drifted/aliased entry in the hand-
  // maintained command list never shows twice in the autocomplete (mirrors the
  // @-path's `new Set` merge below; Claude-Code 2.1.183 fixed the same class of
  // duplicate-in-slash-autocomplete bug).
  const slashCommands = Array.isArray(opts.slashCommands)
    ? [...new Set(opts.slashCommands)].sort()
    : [];

  // User/project custom slash commands (.claude/commands/*.md → `/git:commit`),
  // surfaced in TAB completion the same as built-ins (Claude-Code parity — its
  // slash autocomplete includes user-authored commands too). Pulled from an
  // injected SYNC source so newly authored command files become completable
  // without a restart and `/cd` follows whichever project's commands apply.
  // Cached with the same short TTL as the IDE source so a burst of TABs never
  // re-walks the filesystem.
  const getDynamic =
    typeof opts.getDynamicSlashCommands === "function"
      ? opts.getDynamicSlashCommands
      : null;
  let dynCache = [];
  let dynFetchedAt = -Infinity;
  const dynamicSlashCommands = () => {
    if (!getDynamic) return [];
    if (now() - dynFetchedAt < IDE_CACHE_TTL_MS) return dynCache;
    try {
      const list = getDynamic();
      dynCache = Array.isArray(list)
        ? list.filter((c) => typeof c === "string" && c)
        : [];
    } catch {
      dynCache = []; // a broken command source never breaks completion
    }
    dynFetchedAt = now();
    return dynCache;
  };
  const mergedSlashCommands = () => {
    const dyn = dynamicSlashCommands();
    if (!dyn.length) return slashCommands; // common case: built-ins only
    return [...new Set([...slashCommands, ...dyn])].sort();
  };

  const completeSlash = (line, cursor = line.length) => {
    const command = /^\/[A-Za-z0-9:._-]*(?=[ \t]|$)/u.exec(line)?.[0];
    if (!command) return null;
    const matches = (candidates, prefix) =>
      candidates.filter(
        (word) =>
          typeof word === "string" && word.toLowerCase().startsWith(prefix),
      );
    if (cursor <= command.length) {
      return {
        start: 0,
        end: command.length,
        candidates: matches(
          mergedSlashCommands(),
          line.slice(0, cursor).toLowerCase(),
        ),
        argument: false,
      };
    }
    const getArguments = opts.getSlashArguments;
    if (!getArguments || !slashCommands.includes(command)) return null;
    const separator = /^[ \t]+/u.exec(line.slice(command.length))[0];
    const start = command.length + separator.length;
    const argument = /^(?:"[^"\r\n]*"?|'[^'\r\n]*'?|[^\s"']*)/u.exec(
      line.slice(start),
    )[0];
    const end = start + argument.length;
    if (cursor < start || cursor > end) return null;
    const quote = /^["']/u.exec(argument)?.[0];
    const typed = line.slice(start + Number(Boolean(quote)), cursor);
    const prefix = (
      quote && typed.endsWith(quote) ? typed.slice(0, -1) : typed
    ).toLowerCase();
    const candidates = matches(getArguments(command) || [], prefix)
      .filter((word) => !/[\p{Cc}"']/u.test(word))
      .map((word) => {
        const delimiter = quote || (/\s/u.test(word) ? '"' : "");
        return delimiter + word + delimiter;
      });
    return candidates.length
      ? { start, end, candidates, argument: true }
      : null;
  };

  const completer = (line) => {
    const slash = completeSlash(line);
    if (slash) return [slash.candidates, line.slice(slash.start, slash.end)];
    // `!` bash-mode file-path completion (Claude-Code 2.1.193 parity): the
    // trailing token completes to filesystem paths under cwd — a shell command
    // runs from cwd, so this uses the filesystem candidate set only (not the
    // editor's open-file list). Checked before @refs so a `@` inside a bash
    // command (e.g. `!grep @x file`) still completes the trailing path token.
    const bash = extractBashPathPrefix(line);
    if (bash) {
      const fromFs = fileCandidates(bash.prefix, {
        cwd: getCwd(),
        deps: opts.deps,
      });
      // readline replaces the trailing `prefix` with the chosen path, leaving
      // the `!` and the rest of the command intact.
      return [fromFs.slice(0, MAX_CANDIDATES), bash.prefix];
    }
    const at = extractAtPrefix(line);
    if (!at) return [[], line];
    refreshIde(); // async top-up for the NEXT tab; this one uses the cache
    const norm = fwd(at.prefix).toLowerCase();
    const fromIde = ideFiles.filter((f) => f.toLowerCase().startsWith(norm));
    const fromFs = fileCandidates(at.prefix, {
      cwd: getCwd(),
      deps: opts.deps,
    });
    const merged = [...new Set([...fromIde, ...fromFs])].slice(
      0,
      MAX_CANDIDATES,
    );
    // readline replaces `replaced` with the chosen hit — keep the `@`.
    return [merged.map((m) => `@${m}`), `@${at.prefix}`];
  };
  completer.completeSlash = completeSlash;
  // test seam: expose the cache refresher state
  completer._refreshIde = refreshIde;
  completer._ideState = () => ({ ideFiles, ideFetchedAt });
  return completer;
}
