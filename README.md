# Mind Palace MCP

A local, offline-capable [MCP](https://modelcontextprotocol.io) server that gives an AI agent **semantic (meaning-based) search over your code and local docs**, plus a thin durable **notes** scratchpad.

Built-in `Grep`/`Glob` are *lexical* — they only match exact strings. Mind Palace lets the agent find things by **intent**: ask "where's the retry logic?" and get the file that defines `backoffScheduler`, even though none of those words match literally.

> **Why not MemPalace?** [MemPalace](https://github.com/mempalace/mempalace) is excellent at *conversational* memory (remembering your chats). Mind Palace is the complement: it understands your *codebase*. They don't overlap.

## What it does

| Tool | Purpose |
|---|---|
| `index_path` | Index a folder or file (chunked + embedded). Skips unchanged files. |
| `search` | Meaning-based search over indexed code → ranked `file:line` hits. Scope with `pathPrefix`/`ext`. |
| `remember` | Store a durable note (semantic dedup avoids near-duplicates). |
| `recall` | Find stored notes by meaning. |
| `forget` | Delete a note by id. |
| `status` | Active embedding backend, index stats, and a usage protocol. |

## Never hard-fails: tiered embeddings

On startup it auto-selects the best **available** embedding backend and reports it via `status`:

1. `OPENAI_API_KEY` / `VOYAGE_API_KEY` → API embeddings (best quality)
2. A reachable **Ollama** (`OLLAMA_HOST`, default `http://localhost:11434`, `nomic-embed-text`)
3. A bundled **local model** (`@huggingface/transformers`, all-MiniLM, no key) — *only if you install it* (see below)
4. **Lexical fallback** — deterministic, dependency-free, always works (`status` reports `degraded`)

So it runs anywhere with zero config, and silently upgrades quality the moment a better backend appears.

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

## Register with Claude Code

```bash
claude mcp add -s user mind-palace -- node /absolute/path/to/dist/server.js
# remove later with:  claude mcp remove -s user mind-palace
```
Restart Claude Code so the `mind-palace` tools load. (`-s user` makes it available in every project; use `-s local` for just one.)

## Environment variables

| Var | Meaning |
|---|---|
| `MIND_PALACE_DATA_DIR` | Where the JSON store lives (default `<cwd>/.mindpalace`) |
| `OPENAI_API_KEY` / `VOYAGE_API_KEY` | Use an API embedding backend |
| `OLLAMA_HOST` | Ollama base URL (default `http://localhost:11434`) |
| `MIND_PALACE_EMBEDDER` | Force a backend: `lexical` \| `openai` \| `voyage` \| `ollama` \| `local` |
| `MIND_PALACE_MODEL` | Override the model name for the chosen backend |

## Usage tips (the `status` protocol)

- Prefer `search` when you **don't know the exact identifier**; use `Grep` for exact strings.
- **Scope to sharpen**: `pathPrefix` / `ext` narrow the corpus, which improves accuracy more than any ranking tweak.
- Re-run `index_path` after big changes (unchanged files are skipped automatically).
- If you switch embedding backends, the store rebuilds itself on next start — notes are re-embedded, the code index is cleared for a fresh `index_path`.

## How it works

Files are split into overlapping, line-aware chunks; each chunk is embedded into an L2-normalized vector and stored in a plain JSON file. Search embeds the query and ranks chunks by dot product (= cosine), with an optional keyword boost in `hybrid` mode. Brute-force is plenty fast for the thousands-of-chunks scale of a single project.

Architecture: `src/embeddings/*` (providers + detection), `src/store.ts` (storage + ranking), `src/chunker.ts` (walk + chunk), `src/indexer.ts`, `src/search.ts`, `src/tools.ts` (handlers), `src/server.ts` (MCP wiring). See `docs/superpowers/` for the design spec and implementation plan.

## License

MIT
