// Operational memory capability demo. No grep baseline exists — this is a
// capability grep/semantic-search don't have: typed, verified, per-project
// records that persist across sessions, with recipe staleness.
import { OperationalStore } from "../dist/operational/store.js";
import { formatMarkers } from "../dist/operational/format.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const file = join(mkdtempSync(join(tmpdir(), "ops-demo-")), "operational.json");
let t = new Date("2026-06-05T12:00:00.000Z"); // advanceable clock to show staleness deterministically
const store = new OperationalStore(file, { now: () => t, staleDays: 30 });
const P = "/demo/project";

console.log("1) mark a VERIFIED recipe (exitCode 0 stamps verifiedAt):");
const r = store.mark(P, { kind: "recipe", title: "run tests", command: "npm test", cwd: ".", exitCode: 0, tags: ["ci"] });
console.log(`   -> ${r.marker.id}  verifiedAt=${r.marker.verifiedAt}\n`);

console.log("2) mark a gotcha and a dead-end:");
store.mark(P, { kind: "gotcha", title: "windows path quoting", body: "wrap F: paths in quotes or git errors with 'dubious ownership'" });
store.mark(P, { kind: "deadend", title: "bundle tree-sitter with esbuild", body: "wasm not resolved at build time — load web-tree-sitter at runtime instead" });

console.log("3) upsert: re-mark 'Run Tests' (case-insensitive same title) — stays ONE marker, fields updated:");
store.mark(P, { kind: "recipe", title: "Run Tests", command: "npm test -- --run", exitCode: 0 });
const runTests = store.recall(P).filter((m) => m.title.toLowerCase() === "run tests");
console.log(`   -> "${runTests[0].title}" count=${runTests.length} command="${runTests[0].command}"\n`);

console.log("=== markers NOW (recall, grouped + STALE-flagged) ===");
console.log(formatMarkers(P, store.recall(P)));

console.log("\n=== advance the clock 40 days → the verified recipe crosses the 30-day staleness window ===");
t = new Date("2026-07-15T12:00:00.000Z");
console.log(formatMarkers(P, store.recall(P)));

console.log("\n=== includeStale:false hides the stale recipe (keeps the non-stale gotcha/dead-end) ===");
console.log("   " + store.recall(P, { includeStale: false }).map((m) => `${m.kind}:${m.title}`).join("  |  "));
