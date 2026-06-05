# semkeep

A local, offline-capable [MCP](https://modelcontextprotocol.io) server that gives an AI coding agent **semantic + structural intelligence** about your codebase — plus durable notes anchored to your code. Site: **[semkeep.com](https://semkeep.com)**.

Built-in `Grep`/`Glob` are *lexical* — they only match exact strings. semkeep adds the four things agents are missing:

- **Find by meaning** — ask "where's the retry logic?" and get the function that defines `backoffScheduler`, even though none of those words appear.
- **Understand structure** — `define`, `callers`, `outline`, `imports` over real tree-sitter ASTs.
- **Stay fresh** — the index auto-updates on query as you edit/add/delete files. No manual re-index.
- **Notes that live with code** — anchor a note to a symbol; it surfaces whenever you `define`/`outline` that code.

Runs on your machine. No API key required.

> **Why not MemPalace?** [MemPalace](https://github.com/mempalace/mempalace) is excellent at *conversational* memory (remembering your chats). semkeep is the complement: it understands your *codebase*. They don't overlap.

## What it does

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

The five code/structure tools (`search`, `define`, `callers`, `outline`, `imports`) **auto-freshen** before answering — edit your code and just query; the index updates itself.

## Never hard-fails: tiered embeddings

On startup it auto-selects the best **available** embedding backend and reports it via `status`:

1. `OPENAI_API_KEY` / `VOYAGE_API_KEY` → API embeddings (best quality)
2. A reachable **Ollama** (`OLLAMA_HOST`, default `http://localhost:11434`, `nomic-embed-text`)
3. A bundled **local model** (`@huggingface/transformers`, all-MiniLM, no key) — *only if you install it* (see below)
4. **Lexical fallback** — deterministic, dependency-free, always works (`status` reports `degraded`)

So it runs anywhere with zero config, and silently upgrades quality the moment a better backend appears.

> **⚠️ API keys are used automatically.** Because detection prefers an API backend first, if `OPENAI_API_KEY` or `VOYAGE_API_KEY` is present in your environment (e.g. exported globally for another tool, or sitting in a loaded `.env`), semkeep will use it — sending code chunks to that provider and incurring small embedding costs. To force fully-local embeddings regardless, set `SEMKEEP_EMBEDDER=local` (bundled model) or `SEMKEEP_EMBEDDER=lexical` (zero-dependency). `status` always reports the active backend.

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

## Environment variables

| Var | Meaning |
|---|---|
| `SEMKEEP_DATA_DIR` | Where the JSON store lives (default `<cwd>/.semkeep`) |
| `OPENAI_API_KEY` / `VOYAGE_API_KEY` | Use an API embedding backend |
| `OLLAMA_HOST` | Ollama base URL (default `http://localhost:11434`) |
| `SEMKEEP_EMBEDDER` | Force a backend: `lexical` \| `openai` \| `voyage` \| `ollama` \| `local` |
| `SEMKEEP_MODEL` | Override the model for the chosen backend (e.g. `text-embedding-3-large`, `text-embedding-3-small`, `voyage-3`, `nomic-embed-text`) |
| `SEMKEEP_AUTO_REFRESH` | Set `0` to disable auto-freshen-on-query (default on) |
| `SEMKEEP_REFRESH_DEBOUNCE_MS` | Min ms between freshness scans (default 1500) |

### Choosing a backend & model

Detection is automatic, but you can pin it explicitly:

```bash
# Force fully-local (bundled on-device model) even if an API key is present
SEMKEEP_EMBEDDER=local

# Use OpenAI with the strongest model
SEMKEEP_EMBEDDER=openai
OPENAI_API_KEY=sk-...
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
