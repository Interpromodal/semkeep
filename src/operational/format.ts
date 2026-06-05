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
  for (const m of markers) {
    if (!byKind.has(m.kind)) byKind.set(m.kind, []);
    byKind.get(m.kind)!.push(m);
  }
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
