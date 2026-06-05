# semkeep

A local, offline-capable [MCP](https://modelcontextprotocol.io) server that gives an AI coding agent **semantic + structural intelligence** about your codebase — plus durable notes anchored to your code, operational memory across sessions, and a definition-of-done verification gate. Site: **[semkeep.com](https://semkeep.com)**.

semkeep absorbs two formerly-separate MCP servers: **cairn** (operational memory) and **greenlight** (verification gates) — one install, one server, 16 tools.

Built-in `Grep`/`Glob` are *lexical* — they only match exact strings. semkeep adds the four things agents are missing:

- **Find by meaning** — ask "where's the retry logic?" and get the function that defines `backoffScheduler`, even though none of those words appear.
- **Understand structure** — `define`, `callers`, `outline`, `imports` over real tree-sitter ASTs.
- **Stay fresh** — the index auto-updates on query as you edit/add/delete files. No manual re-index.
- **Notes that live with code** — anchor a note to a symbol; it surfaces whenever you `define`/`outline` that code.

Runs on your machine. No API key required.

> **Why not MemPalace?** [MemPalace](https://github.com/mempalace/mempalace) is excellent at *conversational* memory (remembering your chats). semkeep is the complement: it understands your *codebase*. They don't overlap.

## What it does

**Code intelligence**

| Tool | Purpose |
|---|---|
| `index_path` | Index a folder/file (parsed, symbol-aware chunked, embedded). Skips unchanged. |
| `search` | Meaning-based search → ranked `file:line` hits. Scope with `pathPrefix`/`ext`. |
| `define` | Where a symbol is defined: `file:line`, kind, signature. |
| `callers` | Who references a symbol (identifier-aware call sites, import-ranked). |
| `outline` | The symbols defined in a file/dir, with line ranges. |
| `imports` | What a file imports, and which files import it. |
| `remember` | Store a durable note — optionally anchored to a `symbol`/`file`. |
| `recall` | Find stored notes by meaning. |
| `forget` | Delete a note by id. |
| `refresh` | Force the index to re-scan its roots (index new/changed, prune deleted). |
| `status` | Embedding backend, index/structure stats, roots, and a usage protocol. |

**Operational memory**

| Tool | Purpose |
|---|---|
| `mark` | Record a typed project marker: `recipe` (verified command), `gotcha` (problem + resolution), `deadend` (failed approach), or `note`. Upserts by (kind, title). |
| `markers` | Recall this project's markers, grouped by kind, STALE-flagged. Filter by kind or substring query. |
| `unmark` | Delete a marker by id. |

**Verification**

| Tool | Purpose |
|---|---|
| `greenlight_run` | Run a JSON definition-of-done gate: execute a spec's checks and assert results (exit codes, stdout/stderr patterns, file checks, `json_path`, etc.). Returns GREEN only if all required checks pass. |
| `greenlight_lint` | Statically flag "shallow gates" — checks that would pass without proving anything. Runs nothing. |

The five code/structure tools (`search`, `define`, `callers`, `outline`, `imports`) **auto-freshen** before answering — edit your code and just query; the index updates itself.

## Never hard-fails: tiered embeddings

On startup it auto-selects the best **available** embedding backend and reports it via `status`:

1. `SEMKEEP_OPENAI_API_KEY` / `SEMKEEP_VOYAGE_API_KEY` (or `~/.semkeep/config.json`) → API embeddings (best quality)
2. A reachable **Ollama** (`OLLAMA_HOST`, default `http://localhost:11434`, `nomic-embed-text`)
3. A bundled **local model** (`@huggingface/transformers`, all-MiniLM, no key) — *only if you install it* (see below)
4. **Lexical fallback** — deterministic, dependency-free, always works (`status` reports `degraded`)

So it runs anywhere with zero config, and silently upgrades quality the moment a better backend appears.

> **Credential isolation — your machine-wide API keys are never touched by default.** semkeep does NOT read the ambient `OPENAI_API_KEY` or `VOYAGE_API_KEY` from your environment. It reads only `SEMKEEP_OPENAI_API_KEY` / `SEMKEEP_VOYAGE_API_KEY` (set in semkeep's own MCP-server `env` block) or a `~/.semkeep/config.json` file (`{"openaiKey":"…","voyageKey":"…"}`). The default is the on-device local model — no key, no cost, no data leaves your machine. To opt into ambient keys explicitly, set `SEMKEEP_INHERIT_ENV_KEYS=1`. To force a specific provider, set `SEMKEEP_EMBEDDER=openai|voyage|local|lexical`. `status` always reports the active backend.

### Optional: enable the local semantic model (no API key)
```bash
npm install @huggingface/transformers
```
It's lazily imported, so leaving it out keeps the install lean and the server fast.

## Build & test

```bash
npm install
npm run build      # tsc -> dist/
npm test           # vitest (forces the lexical embedder; no network/model needed)
node scripts/smoke-stdio.mjs   # end-to-end MCP stdio smoke
```

## Install

**As an MCP server (any MCP client):**
```bash
claude mcp add -s user semkeep -- npx -y semkeep
```

**…or as a Claude Code plugin** (bundles the server + the Grep nudge hook in one install):
```bash
/plugin marketplace add Interpromodal/semkeep
/plugin install semkeep@semkeep
```

**…or from source:**
```bash
npm install && npm run build
claude mcp add -s user semkeep -- node /absolute/path/to/dist/server.js
```

Restart Claude Code so the `semkeep` tools load. Requires Node.js 18+. (`-s user` = every project; `-s local` = just this one. Remove with `claude mcp remove -s user semkeep`.)

## Companion: auto-nudge from Grep → search

`hooks/grep-nudge.mjs` is a tiny **PreToolUse hook**. When a `Grep` pattern reads like a natural-language concept query (≥3 plain words, no regex/code characters), it injects a one-line reminder to prefer `search` instead. It stays **silent** for exact strings and regex, and never blocks Grep (always exits 0). Add it to `~/.claude/settings.json` at user scope:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Grep",
        "hooks": [
          { "type": "command", "command": "node", "args": ["/absolute/path/to/hooks/grep-nudge.mjs"], "timeout": 10 }
        ]
      }
    ]
  }
}
```

Open `/hooks` once (or restart) to activate. To disable, delete that block or manage it via `/hooks`.

## Operational memory

Markers are typed, per-project records that survive across sessions. They live in a **global, project-keyed store** at `~/.semkeep/operational.json` (override with `SEMKEEP_OPS_STORE`), separate from the code index — so the SessionStart hook reads them fast and they survive independently of any `index_path` work.

At the start of each session the `markers --hook` output surfaces verified recipes, gotchas, and dead-ends a past session left behind.

```jsonc
// Mark a verified build command (exitCode 0 stamps it verified; stale after 30 days)
{ "kind": "recipe", "title": "run tests", "command": "npm test", "cwd": "/my/project", "exitCode": 0 }

// Mark a gotcha (title = the problem, body = the resolution)
{ "kind": "gotcha", "title": "vitest config not picked up", "body": "vite.config.ts is ignored — rename it to vitest.config.ts" }
```

Kinds: `recipe` | `gotcha` | `deadend` | `note`. Upserts by (kind, title).

## Verification (greenlight)

A **greenlight gate** is a JSON spec (`greenlight.json` at repo root by convention) that defines a set of checks; `greenlight_run` executes them and returns GREEN only if all required checks pass. Use it to lock down your definition of done.

```jsonc
// greenlight.json — minimal project gate
{
  "checks": [
    { "name": "build", "run": "npm run build",
      "assert": [{ "type": "exit_code", "equals": 0 }, { "type": "file_exists", "path": "dist/cli.js" }] },
    { "name": "tests", "run": "npm test",
      "assert": [{ "type": "exit_code", "equals": 0 }, { "type": "stdout_contains", "value": "passed" }] }
  ]
}
```

`greenlight_lint` statically flags shallow gates (checks that would pass even if the command does nothing useful) without running anything.

## CLI

`semkeep` is a dispatcher. Bare invocation (`npx -y semkeep`) starts the MCP server — unchanged. Subcommands:

| Subcommand | Used as | Purpose |
|---|---|---|
| `semkeep markers --hook` | SessionStart hook | Print this project's operational markers at session start |
| `semkeep nudge --hook` | PreCompact hook | Emit a reminder to preserve key context before compaction |
| `semkeep greenlight run <spec.json>` | CLI / CI | Run the gate (exit `0`=GREEN, `1`=NOT GREEN, `2`=spec error) |
| `semkeep greenlight lint <spec.json>` | CLI | Lint the gate spec for shallow checks |
| `semkeep greenlight init` | CLI | Scaffold a starter `greenlight.json` in the current directory |
| `semkeep import-cairn` | One-time migration | Import markers from a cairn store into the semkeep operational store |

Register the SessionStart and PreCompact hooks in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart":  [{ "hooks": [{ "type": "command", "command": "npx", "args": ["-y", "semkeep", "markers", "--hook"] }] }],
    "PreCompact":    [{ "hooks": [{ "type": "command", "command": "npx", "args": ["-y", "semkeep", "nudge",   "--hook"] }] }]
  }
}
```

## Environment variables

| Var | Meaning |
|---|---|
| `SEMKEEP_DATA_DIR` | Where the per-project code/notes store lives (default `<cwd>/.semkeep`) |
| `SEMKEEP_OPS_STORE` | Override path for the global operational markers store (default `~/.semkeep/operational.json`) |
| `SEMKEEP_PROJECT` | Override the project key used to scope operational markers (default: `cwd`) |
| `SEMKEEP_OPENAI_API_KEY` | OpenAI API key for semkeep only (preferred over ambient key) |
| `SEMKEEP_VOYAGE_API_KEY` | Voyage AI key for semkeep only (preferred over ambient key) |
| `SEMKEEP_INHERIT_ENV_KEYS` | Set `1` to allow semkeep to fall back to ambient `OPENAI_API_KEY` / `VOYAGE_API_KEY` |
| `OPENAI_API_KEY` / `VOYAGE_API_KEY` | Ambient keys — only consulted if `SEMKEEP_INHERIT_ENV_KEYS=1` |
| `OLLAMA_HOST` | Ollama base URL (default `http://localhost:11434`) |
| `SEMKEEP_EMBEDDER` | Force a backend: `lexical` \| `openai` \| `voyage` \| `ollama` \| `local` |
| `SEMKEEP_MODEL` | Override the model for the chosen backend (e.g. `text-embedding-3-large`, `text-embedding-3-small`, `voyage-3`, `nomic-embed-text`) |
| `SEMKEEP_AUTO_REFRESH` | Set `0` to disable auto-freshen-on-query (default on) |
| `SEMKEEP_REFRESH_DEBOUNCE_MS` | Min ms between freshness scans (default 1500) |

### Choosing a backend & model

Detection is automatic, but you can pin it explicitly:

```bash
# Force fully-local (bundled on-device model) — default, no key needed
SEMKEEP_EMBEDDER=local

# Use OpenAI with the strongest model (key isolated to semkeep)
SEMKEEP_EMBEDDER=openai
SEMKEEP_OPENAI_API_KEY=sk-...
SEMKEEP_MODEL=text-embedding-3-large    # default is text-embedding-3-small
```

In [our benchmark](https://buildreach.substack.com/p/i-let-an-ai-build-the-tool-it-wished) a stronger embedding model took semantic search from *losing* to grep to clearly *beating* it — but the **biggest model wasn't always the best** (it sometimes ranked example/demo code above the real implementation), so test on your own codebase. Run `status` to confirm which backend and model are active.

## Usage tips (the `status` protocol)

- Prefer `search` when you **don't know the exact identifier**; use `Grep` for exact strings.
- **Scope to sharpen**: `pathPrefix` / `ext` narrow the corpus, which improves accuracy more than any ranking tweak.
- **Freshness is automatic** — after you edit/add/delete files, the index updates itself on the next query (`SEMKEEP_AUTO_REFRESH=0` disables it; `refresh` forces it).
- If you switch embedding backends, the store rebuilds itself on next start — notes are re-embedded, the code index is cleared for a fresh `index_path`.

## How it works

Files are split into overlapping, line-aware chunks; each chunk is embedded into an L2-normalized vector and stored in a plain JSON file. Search embeds the query and ranks chunks by dot product (= cosine), with an optional keyword boost in `hybrid` mode. Brute-force is plenty fast for the thousands-of-chunks scale of a single project.

Architecture: `src/embeddings/*` (providers + detection), `src/store.ts` (storage + ranking), `src/chunker.ts` (walk + chunk), `src/indexer.ts`, `src/search.ts`, `src/tools.ts` (handlers), `src/server.ts` (MCP wiring). See `docs/superpowers/` for the design spec and implementation plan.

## Support

semkeep is free and MIT-licensed. If it saves you time, you can drop a coin in the jar to fund maintenance and the next tool like this one: **[Venmo @InsertCoin](https://venmo.com/u/InsertCoin)**. 🙏

## License

MIT
