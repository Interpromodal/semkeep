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
