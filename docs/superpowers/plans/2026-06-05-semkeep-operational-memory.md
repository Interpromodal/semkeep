# Operational Memory (cairn parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give semkeep cairn's operational memory — typed, verified, per-project markers (`recipe`/`gotcha`/`deadend`/`note`) with exact upsert-by-title and recipe staleness — exposed as `mark`/`markers`/`unmark`, in a dedicated lean global store, without touching the semantic-note layer.

**Architecture:** A new `src/operational/` module ports cairn's pure store logic (injectable clock/id/staleDays) into a single `OperationalStore` class backed by `~/.semkeep/operational.json` (`{version, projects:{<absPath>:{markers:[]}}}`, project-keyed). Thin async tool handlers in `tools.ts` resolve the project, delegate, and format. No embeddings, no contact with the code/notes `store.json`.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest, `@modelcontextprotocol/sdk` `registerTool` + zod. Node ≥ 18. Sync `node:fs` (mirrors semkeep's existing `Store`).

**Plan 1 of 3** (operational memory → greenlight port → integration/cutover). Work on branch `feat/consolidate-cairn-greenlight`. Source of truth for parity: `F:/Dreams/Dream4/src/{store,paths,format}.js` and `test/store.test.js`.

---

## File Structure

- `src/operational/types.ts` — **Create.** `Marker`, `MarkerKind`, `MARKER_KINDS`, `MarkerView`, `OperationalData`.
- `src/operational/paths.ts` — **Create.** `resolveProject()`, `defaultOpsStorePath()`.
- `src/operational/store.ts` — **Create.** `OperationalStore` (mark/recall/forget/isStale, injectable deps).
- `src/operational/format.ts` — **Create.** `formatMarkers()`, `formatMark()`.
- `src/tools.ts` — **Modify.** Add `markTool`, `markersTool`, `unmarkTool`; extend `statusTool` + `PROTOCOL`.
- `src/server.ts` — **Modify.** Register `mark`, `markers`, `unmark`.
- `test/operational-store.test.ts` — **Create.** Port of cairn's 12 store tests.
- `test/operational-format.test.ts` — **Create.** Format output tests.
- `test/operational-tools.test.ts` — **Create.** Tool-handler round-trips.

---

## Task 1: Types + path resolution

**Files:**
- Create: `src/operational/types.ts`
- Create: `src/operational/paths.ts`
- Test: `test/operational-paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/operational-paths.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { resolveProject, defaultOpsStorePath } from "../src/operational/paths.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("resolveProject", () => {
  it("uses the explicit arg first, resolved to absolute", () => {
    expect(resolveProject("foo/bar")).toBe(resolve("foo/bar"));
  });
  it("falls back to SEMKEEP_PROJECT, then CLAUDE_PROJECT_DIR, then cwd", () => {
    delete process.env.SEMKEEP_PROJECT;
    process.env.CLAUDE_PROJECT_DIR = resolve("/tmp/claudeproj");
    expect(resolveProject()).toBe(resolve("/tmp/claudeproj"));
    process.env.SEMKEEP_PROJECT = resolve("/tmp/semkeepproj");
    expect(resolveProject()).toBe(resolve("/tmp/semkeepproj"));
  });
});

describe("defaultOpsStorePath", () => {
  it("defaults to ~/.semkeep/operational.json", () => {
    delete process.env.SEMKEEP_OPS_STORE;
    expect(defaultOpsStorePath()).toBe(join(homedir(), ".semkeep", "operational.json"));
  });
  it("honors SEMKEEP_OPS_STORE, resolved to absolute", () => {
    process.env.SEMKEEP_OPS_STORE = "rel/ops.json";
    expect(defaultOpsStorePath()).toBe(resolve("rel/ops.json"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/operational-paths.test.ts`
Expected: FAIL — cannot find module `../src/operational/paths.js`.

- [ ] **Step 3: Create the types**

Create `src/operational/types.ts`:
```ts
export type MarkerKind = "recipe" | "gotcha" | "deadend" | "note";
export const MARKER_KINDS: MarkerKind[] = ["recipe", "gotcha", "deadend", "note"];

/** One operational marker. All kinds share this shape; `kind` drives id-prefix
 * and recipe-only verifiedAt/staleness. ISO 8601 timestamps. */
export interface Marker {
  id: string;
  kind: MarkerKind;
  title: string; // raw display text
  body?: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
}

/** A marker decorated with read-time staleness (never persisted). */
export type MarkerView = Marker & { stale: boolean };

/** On-disk shape of ~/.semkeep/operational.json. Project key = resolved abs path. */
export interface OperationalData {
  version: 1;
  projects: Record<string, { markers: Marker[] }>;
}
```

- [ ] **Step 4: Create path resolution**

Create `src/operational/paths.ts`:
```ts
import { homedir } from "node:os";
import { resolve, join } from "node:path";

/** Resolve the project key: explicit arg → SEMKEEP_PROJECT → CLAUDE_PROJECT_DIR → cwd. */
export function resolveProject(project?: string): string {
  return resolve(
    project ||
      process.env.SEMKEEP_PROJECT ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd(),
  );
}

/** Path to the global operational store. Override with SEMKEEP_OPS_STORE. */
export function defaultOpsStorePath(): string {
  return process.env.SEMKEEP_OPS_STORE
    ? resolve(process.env.SEMKEEP_OPS_STORE)
    : join(homedir(), ".semkeep", "operational.json");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/operational-paths.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/operational/types.ts src/operational/paths.ts test/operational-paths.test.ts
git commit -m "feat(operational): marker types + project/path resolution"
```

---

## Task 2: OperationalStore (mark / recall / forget / staleness)

This is the parity core. It ports `F:/Dreams/Dream4/src/store.js` verbatim in behavior.

**Files:**
- Create: `src/operational/store.ts`
- Test: `test/operational-store.test.ts`

- [ ] **Step 1: Write the failing test (port of cairn's 12 store tests)**

Create `test/operational-store.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OperationalStore } from "../src/operational/store.js";
import type { MarkerKind } from "../src/operational/types.js";

const FIXED = "2026-06-05T12:00:00.000Z";
function fixedClock(iso = FIXED) {
  let t = new Date(iso);
  return { now: () => t, set: (s: string) => (t = new Date(s)) };
}
function seqId() {
  const n: Record<string, number> = {};
  return (kind: MarkerKind) => `${kind}_${(n[kind] = (n[kind] ?? 0) + 1)}`;
}

const dirs: string[] = [];
function tempFile(): string {
  const d = mkdtempSync(join(tmpdir(), "semkeep-ops-"));
  dirs.push(d);
  return join(d, "operational.json");
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function plainStore(file: string, staleDays = 30) {
  const clock = fixedClock();
  const store = new OperationalStore(file, { now: clock.now, genId: seqId(), staleDays });
  return { store, clock };
}

const P = "/proj/a";

describe("OperationalStore", () => {
  it("mark creates a marker and recall returns it (recipe exit 0 → verified, not stale)", () => {
    const { store } = plainStore(tempFile());
    const { marker, upserted } = store.mark(P, {
      kind: "recipe", title: "run tests", command: "npm test", exitCode: 0, tags: ["ci"],
    });
    expect(upserted).toBe(false);
    expect(marker.id).toBe("recipe_1");
    expect(marker.verifiedAt).toBe(FIXED);
    const got = store.recall(P);
    expect(got).toHaveLength(1);
    expect(got[0].title).toBe("run tests");
    expect(got[0].stale).toBe(false);
  });

  it("upserts by kind+title (case-insensitive) and refreshes verifiedAt on exit 0", () => {
    const file = tempFile();
    const { store, clock } = plainStore(file);
    const first = store.mark(P, { kind: "recipe", title: "Run Tests", command: "old", exitCode: 1 });
    expect(first.upserted).toBe(false);
    expect(first.marker.verifiedAt).toBeUndefined();
    clock.set("2026-07-10T00:00:00.000Z");
    const second = store.mark(P, { kind: "recipe", title: "run tests", command: "node --test", exitCode: 0 });
    expect(second.upserted).toBe(true);
    expect(second.marker.id).toBe("recipe_1");
    expect(second.marker.command).toBe("node --test");
    expect(second.marker.verifiedAt).toBe("2026-07-10T00:00:00.000Z");
    expect(store.recall(P)).toHaveLength(1);
  });

  it("recall filters by query and by kind", () => {
    const { store } = plainStore(tempFile());
    store.mark(P, { kind: "recipe", title: "run tests", command: "npm test" });
    store.mark(P, { kind: "recipe", title: "build", command: "npm run build" });
    store.mark(P, { kind: "gotcha", title: "flaky test on CI" });
    expect(store.recall(P, { query: "test" })).toHaveLength(2);
    const recipes = store.recall(P, { kind: "recipe" });
    expect(recipes).toHaveLength(2);
    expect(recipes.every((m) => m.kind === "recipe")).toBe(true);
  });

  it("flags stale recipes and includeStale=false hides them", () => {
    const file = tempFile();
    const { store, clock } = plainStore(file, 30);
    store.mark(P, { kind: "recipe", title: "verified", command: "x", exitCode: 0 });
    store.mark(P, { kind: "recipe", title: "never", command: "y", exitCode: 1 });
    clock.set("2026-08-03T12:00:00.000Z"); // ~59 days later
    const all = store.recall(P);
    expect(all.every((m) => m.stale)).toBe(true);
    expect(store.recall(P, { includeStale: false })).toHaveLength(0);
  });

  it("a recipe within the staleness window is not stale", () => {
    const file = tempFile();
    const { store, clock } = plainStore(file, 30);
    store.mark(P, { kind: "recipe", title: "fresh", command: "x", exitCode: 0 });
    clock.set("2026-06-24T12:00:00.000Z"); // 19 days
    expect(store.recall(P)[0].stale).toBe(false);
  });

  it("non-recipe markers are never stale", () => {
    const file = tempFile();
    const { store, clock } = plainStore(file, 1);
    store.mark(P, { kind: "gotcha", title: "watch out" });
    clock.set("2027-06-05T12:00:00.000Z"); // a year later
    expect(store.recall(P)[0].stale).toBe(false);
  });

  it("forget removes by id and returns false when absent", () => {
    const { store } = plainStore(tempFile());
    const { marker } = store.mark(P, { kind: "note", title: "remember me" });
    expect(store.forget(P, marker.id)).toBe(true);
    expect(store.recall(P)).toHaveLength(0);
    expect(store.forget(P, "nope")).toBe(false);
  });

  it("markers are isolated per project", () => {
    const { store } = plainStore(tempFile());
    store.mark("/a", { kind: "note", title: "a-note" });
    store.mark("/b", { kind: "note", title: "b-note" });
    expect(store.recall("/a")).toHaveLength(1);
    expect(store.recall("/b")[0].title).toBe("b-note");
  });

  it("data persists across store instances and the file is tidy JSON", () => {
    const file = tempFile();
    plainStore(file).store.mark(P, { kind: "recipe", title: "go", command: "go test ./..." });
    const fresh = new OperationalStore(file, { genId: seqId() });
    const got = fresh.recall(P);
    expect(got).toHaveLength(1);
    expect(got[0].command).toBe("go test ./...");
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed.version).toBe(1);
  });

  it("upsert does not lose writes across many marks", () => {
    const { store } = plainStore(tempFile());
    for (let i = 0; i < 10; i++) store.mark(P, { kind: "note", title: `n${i}` });
    expect(store.recall(P)).toHaveLength(10);
  });

  it("input validation", () => {
    const { store } = plainStore(tempFile());
    expect(() => store.mark(P, { kind: "bogus" as MarkerKind, title: "x" })).toThrow(/kind one of/);
    expect(() => store.mark(P, { kind: "note", title: "   " })).toThrow(/non-empty title/);
    expect(() => store.recall("")).toThrow(/requires a project/);
    expect(() => store.forget(P, "")).toThrow(/requires an id/);
  });

  it("a corrupt store file produces a clear error", () => {
    const file = tempFile();
    writeFileSync(file, "{ not json at all", "utf8");
    expect(() => plainStore(file).store.recall(P)).toThrow(/not valid JSON/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/operational-store.test.ts`
Expected: FAIL — cannot find module `../src/operational/store.js`.

- [ ] **Step 3: Implement `OperationalStore`**

Create `src/operational/store.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import {
  MARKER_KINDS,
  type Marker,
  type MarkerKind,
  type MarkerView,
  type OperationalData,
} from "./types.js";

export const STORE_VERSION = 1 as const;
export const DEFAULT_STALE_DAYS = 30;
const DAY_MS = 86_400_000;
const ID_PREFIX: Record<MarkerKind, string> = {
  recipe: "rcp", gotcha: "gca", deadend: "ded", note: "not",
};

export interface MarkInput {
  kind: MarkerKind;
  title: string;
  body?: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  tags?: string[];
}
export interface RecallFilter {
  query?: string;
  kind?: MarkerKind;
  includeStale?: boolean; // default true
}
export interface OperationalDeps {
  now?: () => Date;
  genId?: (kind: MarkerKind) => string;
  staleDays?: number;
}

function defaultGenId(kind: MarkerKind): string {
  const prefix = ID_PREFIX[kind] ?? "mrk";
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeTitle(title: string): string {
  return String(title).trim().toLowerCase().replace(/\s+/g, " ");
}

export class OperationalStore {
  private readonly now: () => Date;
  private readonly genId: (kind: MarkerKind) => string;
  private readonly staleDays: number;

  constructor(private readonly file: string, deps: OperationalDeps = {}) {
    this.now = deps.now ?? (() => new Date());
    this.genId = deps.genId ?? defaultGenId;
    this.staleDays = deps.staleDays ?? DEFAULT_STALE_DAYS;
  }

  private read(): OperationalData {
    if (!existsSync(this.file)) return { version: STORE_VERSION, projects: {} };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      throw new Error(
        `semkeep operational store at ${this.file} is not valid JSON. Fix or remove the file to continue.`,
      );
    }
    if (!parsed || typeof parsed !== "object" || typeof (parsed as OperationalData).projects !== "object") {
      throw new Error(`semkeep operational store at ${this.file} has an unexpected shape.`);
    }
    return parsed as OperationalData;
  }

  private write(data: OperationalData): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    renameSync(tmp, this.file);
  }

  private isStale(m: Marker, nowMs: number): boolean {
    if (m.kind !== "recipe") return false;
    if (!m.verifiedAt) return true;
    const v = Date.parse(m.verifiedAt);
    if (Number.isNaN(v)) return true;
    return nowMs - v > this.staleDays * DAY_MS;
  }

  mark(project: string, input: MarkInput): { marker: Marker; upserted: boolean } {
    if (!project) throw new Error("mark requires a project");
    if (!MARKER_KINDS.includes(input.kind)) {
      throw new Error(`mark requires a kind one of: ${MARKER_KINDS.join(", ")}`);
    }
    const title = String(input.title ?? "").trim();
    if (!title) throw new Error("mark requires a non-empty title");

    const data = this.read();
    const bucket = (data.projects[project] ??= { markers: [] });
    const nowIso = this.now().toISOString();
    const norm = normalizeTitle(title);
    const verified = input.kind === "recipe" && input.exitCode === 0;
    const existing = bucket.markers.find(
      (m) => m.kind === input.kind && normalizeTitle(m.title) === norm,
    );

    if (existing) {
      existing.title = title;
      if (input.body !== undefined) existing.body = input.body;
      if (input.command !== undefined) existing.command = input.command;
      if (input.cwd !== undefined) existing.cwd = input.cwd;
      if (input.exitCode !== undefined) existing.exitCode = input.exitCode;
      if (input.tags !== undefined) existing.tags = input.tags;
      existing.updatedAt = nowIso;
      if (verified) existing.verifiedAt = nowIso;
      this.write(data);
      return { marker: existing, upserted: true };
    }

    const marker: Marker = {
      id: this.genId(input.kind),
      kind: input.kind,
      title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.command !== undefined ? { command: input.command } : {}),
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
      ...(verified ? { verifiedAt: nowIso } : {}),
    };
    bucket.markers.push(marker);
    this.write(data);
    return { marker, upserted: false };
  }

  recall(project: string, filter: RecallFilter = {}): MarkerView[] {
    if (!project) throw new Error("recall requires a project");
    if (filter.kind && !MARKER_KINDS.includes(filter.kind)) {
      throw new Error(`recall kind must be one of: ${MARKER_KINDS.join(", ")}`);
    }
    const data = this.read();
    const nowMs = this.now().getTime();
    const includeStale = filter.includeStale ?? true;
    const q = filter.query?.toLowerCase().trim();

    let markers: MarkerView[] = (data.projects[project]?.markers ?? []).map((m) => ({
      ...m,
      stale: this.isStale(m, nowMs),
    }));
    if (filter.kind) markers = markers.filter((m) => m.kind === filter.kind);
    if (q) {
      markers = markers.filter((m) =>
        [m.title, m.body, m.command, ...(m.tags ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    if (!includeStale) markers = markers.filter((m) => !m.stale);
    return markers.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  forget(project: string, id: string): boolean {
    if (!project) throw new Error("forget requires a project");
    if (!id) throw new Error("forget requires an id");
    const data = this.read();
    const bucket = data.projects[project];
    if (!bucket) return false;
    const before = bucket.markers.length;
    bucket.markers = bucket.markers.filter((m) => m.id !== id);
    if (bucket.markers.length === before) return false;
    this.write(data);
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/operational-store.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/operational/store.ts test/operational-store.test.ts
git commit -m "feat(operational): OperationalStore with upsert + recipe staleness (cairn parity)"
```

---

## Task 3: Formatting

**Files:**
- Create: `src/operational/format.ts`
- Test: `test/operational-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/operational-format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatMarkers, formatMark } from "../src/operational/format.js";
import type { Marker, MarkerView } from "../src/operational/types.js";

const base = (over: Partial<Marker>): Marker => ({
  id: "rcp_1", kind: "recipe", title: "run tests",
  createdAt: "2026-06-05T12:00:00.000Z", updatedAt: "2026-06-05T12:00:00.000Z", ...over,
});

describe("formatMarkers", () => {
  it("renders an empty nudge when there are no markers", () => {
    const out = formatMarkers("/proj", []);
    expect(out).toMatch(/No operational markers yet for \/proj/);
  });
  it("groups by kind, shows command/exit/verified, and flags STALE", () => {
    const markers: MarkerView[] = [
      { ...base({ command: "npm test", exitCode: 0, verifiedAt: "2026-06-05T12:00:00.000Z" }), stale: false },
      { ...base({ id: "gca_1", kind: "gotcha", title: "flaky on CI", body: "retry once" }), stale: false },
      { ...base({ id: "rcp_2", title: "deploy", verifiedAt: undefined }), stale: true },
    ];
    const out = formatMarkers("/proj", markers);
    expect(out).toMatch(/## Recipes/);
    expect(out).toMatch(/## Gotchas/);
    expect(out).toContain("`npm test`");
    expect(out).toContain("exit code: 0");
    expect(out).toMatch(/STALE/);
    expect(out).toContain("retry once");
  });
});

describe("formatMark", () => {
  it("confirms a new vs updated marker and notes verification", () => {
    const made = formatMark("/proj", { marker: base({ verifiedAt: "2026-06-05T12:00:00.000Z" }), upserted: false });
    expect(made).toMatch(/Added recipe/);
    expect(made).toMatch(/verified/);
    const upd = formatMark("/proj", { marker: base({ id: "not_1", kind: "note", title: "x" }), upserted: true });
    expect(upd).toMatch(/Updated note/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/operational-format.test.ts`
Expected: FAIL — cannot find module `../src/operational/format.js`.

- [ ] **Step 3: Implement formatting**

Create `src/operational/format.ts`:
```ts
import type { Marker, MarkerView } from "./types.js";

const KIND_LABEL: Record<Marker["kind"], string> = {
  recipe: "Recipes", gotcha: "Gotchas", deadend: "Dead-ends", note: "Notes",
};
const KIND_ORDER: Marker["kind"][] = ["recipe", "gotcha", "deadend", "note"];

function formatOne(m: MarkerView): string {
  const lines: string[] = [`- **${m.title}**  \`${m.id}\`${m.stale ? "  ⚠️ STALE — re-verify before trusting" : ""}`];
  if (m.command) lines.push(`  - command: \`${m.command}\`${m.cwd ? `  (cwd: ${m.cwd})` : ""}`);
  if (m.exitCode !== undefined) lines.push(`  - exit code: ${m.exitCode}`);
  if (m.verifiedAt) lines.push(`  - verified: ${m.verifiedAt}`);
  if (m.body) lines.push(`  - ${m.body}`);
  if (m.tags?.length) lines.push(`  - tags: ${m.tags.join(", ")}`);
  return lines.join("\n");
}

/** Grouped, staleness-flagged markdown for `markers` and the SessionStart hook. */
export function formatMarkers(project: string, markers: MarkerView[]): string {
  if (!markers.length) {
    return (
      `No operational markers yet for ${project}.\n\n` +
      `Record a verified command, gotcha, or dead-end with \`mark\` so a future session doesn't rediscover it.`
    );
  }
  const byKind = new Map<Marker["kind"], MarkerView[]>();
  for (const m of markers) (byKind.get(m.kind) ?? byKind.set(m.kind, []).get(m.kind)!).push(m);
  const sections: string[] = [`# semkeep operational memory for ${project}`, `${markers.length} marker(s).`];
  for (const kind of KIND_ORDER) {
    const group = byKind.get(kind);
    if (!group?.length) continue;
    sections.push(`## ${KIND_LABEL[kind]} (${group.length})\n` + group.map(formatOne).join("\n"));
  }
  return sections.join("\n\n");
}

/** One-line confirmation for `mark`. */
export function formatMark(project: string, r: { marker: Marker; upserted: boolean }): string {
  const verb = r.upserted ? "Updated" : "Added";
  const stamp = r.marker.verifiedAt ? ` (verified ${r.marker.verifiedAt})` : "";
  return `${verb} ${r.marker.kind} marker "${r.marker.title}"  \`${r.marker.id}\`${stamp} for ${project}.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/operational-format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/operational/format.ts test/operational-format.test.ts
git commit -m "feat(operational): grouped, staleness-flagged formatting"
```

---

## Task 4: MCP tool handlers + registration

**Files:**
- Modify: `src/tools.ts` (add handlers near the note tools, ~after `forgetTool`)
- Modify: `src/server.ts` (register after the `forget` tool)
- Test: `test/operational-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/operational-tools.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markTool, markersTool, unmarkTool } from "../src/tools.js";

const dirs: string[] = [];
function opsFile(): string {
  const d = mkdtempSync(join(tmpdir(), "semkeep-opstool-"));
  dirs.push(d);
  return join(d, "operational.json");
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  delete process.env.SEMKEEP_OPS_STORE;
  delete process.env.SEMKEEP_PROJECT;
});

describe("operational tools", () => {
  it("mark → markers → unmark round-trip via the resolved project", async () => {
    process.env.SEMKEEP_OPS_STORE = opsFile();
    process.env.SEMKEEP_PROJECT = "/proj/x";

    const made = await markTool({ kind: "recipe", title: "run tests", command: "npm test", exitCode: 0 });
    expect(made).toMatch(/Added recipe/);

    const list = await markersTool({});
    expect(list).toContain("run tests");
    expect(list).toContain("`npm test`");

    const idMatch = made.match(/`([a-z]{3}_[^`]+)`/);
    expect(idMatch).toBeTruthy();
    const gone = await unmarkTool({ id: idMatch![1] });
    expect(gone).toMatch(/Forgot|Unmarked/);
    expect(await markersTool({})).toMatch(/No operational markers/);
  });

  it("markers is silent-friendly and respects kind filter", async () => {
    process.env.SEMKEEP_OPS_STORE = opsFile();
    await markTool({ kind: "gotcha", title: "flaky", project: "/proj/y" });
    const recipes = await markersTool({ project: "/proj/y", kind: "recipe" });
    expect(recipes).toMatch(/No operational markers/);
    const gotchas = await markersTool({ project: "/proj/y", kind: "gotcha" });
    expect(gotchas).toContain("flaky");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/operational-tools.test.ts`
Expected: FAIL — `markTool` is not exported from `../src/tools.js`.

- [ ] **Step 3: Implement the tool handlers**

In `src/tools.ts`, add imports at the top (after the existing imports):
```ts
import { OperationalStore, type MarkInput, type RecallFilter } from "./operational/store.js";
import { resolveProject, defaultOpsStorePath } from "./operational/paths.js";
import { formatMarkers, formatMark } from "./operational/format.js";
import type { MarkerKind } from "./operational/types.js";
```

Then add these handlers (operational memory needs no embedder/context — it has its own store):
```ts
function opsStore(): OperationalStore {
  return new OperationalStore(defaultOpsStorePath());
}

export async function markTool(
  args: { kind: MarkerKind; title: string; project?: string } & Omit<MarkInput, "kind" | "title">,
): Promise<string> {
  const project = resolveProject(args.project);
  const { kind, title, body, command, cwd, exitCode, tags } = args;
  const r = opsStore().mark(project, { kind, title, body, command, cwd, exitCode, tags });
  return formatMark(project, r);
}

export async function markersTool(
  args: { project?: string; query?: string; kind?: MarkerKind; includeStale?: boolean },
): Promise<string> {
  const project = resolveProject(args.project);
  const filter: RecallFilter = { query: args.query, kind: args.kind, includeStale: args.includeStale };
  return formatMarkers(project, opsStore().recall(project, filter));
}

export async function unmarkTool(args: { id: string; project?: string }): Promise<string> {
  const project = resolveProject(args.project);
  const ok = opsStore().forget(project, args.id);
  return ok ? `Forgot marker ${args.id} for ${project}.` : `No marker ${args.id} found for ${project}.`;
}
```

- [ ] **Step 4: Register the tools in `src/server.ts`**

Add to the import block from `./tools.js`: `markTool`, `markersTool`, `unmarkTool`. Then register (after the `forget` registration, before `status`):
```ts
server.registerTool(
  "mark",
  {
    description:
      "Record a typed, per-project operational marker: a verified recipe (command+exitCode), a gotcha, a dead-end, or a note. Upserts by (kind, title). Recipes with exitCode 0 are stamped verified.",
    inputSchema: {
      kind: z.enum(["recipe", "gotcha", "deadend", "note"]).describe("Marker kind"),
      title: z.string().describe("Short title; upsert key together with kind"),
      project: z.string().optional().describe("Project path (default: resolved cwd)"),
      body: z.string().optional().describe("Resolution / explanation / why-it-failed"),
      command: z.string().optional().describe("The exact command (recipes)"),
      cwd: z.string().optional().describe("Directory the command runs in"),
      exitCode: z.number().int().optional().describe("Observed exit code (0 verifies a recipe)"),
      tags: z.array(z.string()).optional().describe("Optional tags"),
    },
  },
  async (args) => text(await markTool(args)),
);

server.registerTool(
  "markers",
  {
    description:
      "Recall this project's operational markers (recipes/gotchas/dead-ends/notes), grouped and STALE-flagged. Filter by kind or a substring query.",
    inputSchema: {
      project: z.string().optional().describe("Project path (default: resolved cwd)"),
      query: z.string().optional().describe("Substring filter over title/body/command/tags"),
      kind: z.enum(["recipe", "gotcha", "deadend", "note"]).optional().describe("Restrict to one kind"),
      includeStale: z.boolean().optional().describe("Include stale recipes (default true)"),
    },
  },
  async (args) => text(await markersTool(args)),
);

server.registerTool(
  "unmark",
  {
    description: "Delete an operational marker by id.",
    inputSchema: {
      id: z.string().describe("Marker id, e.g. rcp_a1b2c3"),
      project: z.string().optional().describe("Project path (default: resolved cwd)"),
    },
  },
  async (args) => text(await unmarkTool(args)),
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/operational-tools.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Build to confirm registration type-checks**

Run: `npm run build`
Expected: `tsc` exits 0 (no type errors in `server.ts`/`tools.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/tools.ts src/server.ts test/operational-tools.test.ts
git commit -m "feat(operational): mark/markers/unmark MCP tools"
```

---

## Task 5: Surface operational memory in `status` + protocol

**Files:**
- Modify: `src/tools.ts` (`statusTool`, `PROTOCOL`)
- Test: `test/operational-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/operational-status.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { statusTool, type Context } from "../src/tools.js";
import { LexicalEmbedder } from "../src/embeddings/lexical.js";
import { Store } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("statusTool", () => {
  it("reports the operational store path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "semkeep-status-"));
    const store = await Store.load(dir);
    const emb = new LexicalEmbedder(256);
    store.setEmbedderMeta(emb.name, emb.dim);
    const ctx: Context = { store, embedder: emb, degraded: true, config: loadConfig() };
    const out = statusTool(ctx);
    expect(out).toMatch(/operational:/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/operational-status.test.ts`
Expected: FAIL — output has no `operational:` line.

- [ ] **Step 3: Extend `statusTool` and `PROTOCOL`**

In `src/tools.ts`, change the `PROTOCOL` constant's final sentence to add operational + verification guidance:
```ts
  "Use remember/recall for durable semantic notes; use mark/markers for verified " +
  "operational memory (recipes/gotchas/dead-ends, per project); use greenlight_run to prove a task is done.";
```

In `statusTool`, add an `operational:` line (compute the count from the ops store). Add near the top of the function:
```ts
  const ops = new OperationalStore(defaultOpsStorePath());
  const opsCount = ops.recall(resolveProject(), { includeStale: true }).length;
```
and insert into the returned array, after the `notes:` line:
```ts
    `operational: ${opsCount} marker(s) for this project — ${defaultOpsStorePath()}`,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/operational-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the FULL suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all pre-existing test files plus the 5 new operational test files green.

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts test/operational-status.test.ts
git commit -m "feat(operational): surface marker count + store path in status"
```

---

## Self-Review (completed during planning)

**Spec coverage:** typed kinds ✓ (Task 1/2), exitCode/verifiedAt + verified-on-exit-0 ✓ (Task 2), recipe staleness ✓ (Task 2), upsert-by-(project,kind,normalizedTitle) ✓ (Task 2), per-project keying ✓ (Task 2, paths Task 1), `mark`/`markers`/`unmark` tools ✓ (Task 4), dedicated global store at `~/.semkeep/operational.json` ✓ (Task 1 paths + Task 2 store), no contact with notes/code store ✓ (handlers use their own `OperationalStore`), status surfaced ✓ (Task 5). **Out of scope for Plan 1 (handled in Plan 3):** the SessionStart/PreCompact CLI hooks, migration from `~/.cairn`, credential isolation, cutover/deregistration, docs.

**Placeholder scan:** none — every step has runnable code/commands.

**Type consistency:** `MarkInput`/`RecallFilter`/`MarkerKind`/`MarkerView`/`OperationalData` used identically across store, tools, and tests; `mark`/`recall`/`forget` signatures match between `store.ts` and the handlers; `formatMarkers`/`formatMark` signatures match their tests.

**Note for the implementer:** the `byKind` grouping line in `format.ts` uses a get-or-create idiom; if it reads awkwardly during implementation, replace with a plain `if (!byKind.has(m.kind)) byKind.set(m.kind, [])` then `byKind.get(m.kind)!.push(m)` — behavior identical.
