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
