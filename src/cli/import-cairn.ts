// CLI entry point for `semkeep import-cairn`: migrate a cairn store into semkeep's operational store.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { flag } from "./args.js";

export async function importCairn(argv: string[]): Promise<void> {
  const from = resolve(flag(argv, "--from") ?? join(homedir(), ".cairn", "cairn.json"));
  const into = resolve(
    flag(argv, "--into") ??
      process.env.SEMKEEP_OPS_STORE ??
      join(homedir(), ".semkeep", "operational.json"),
  );
  if (!existsSync(from)) {
    console.error(`no cairn store at ${from}`);
    process.exitCode = 1;
    return;
  }
  let src: { projects?: Record<string, { markers: unknown[] }> };
  try { src = JSON.parse(readFileSync(from, "utf8")); }
  catch { console.error(`import-cairn: malformed JSON in ${from}`); process.exitCode = 1; return; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dst: { version: number; projects: Record<string, { markers: any[] }> };
  if (existsSync(into)) {
    try { dst = JSON.parse(readFileSync(into, "utf8")); }
    catch { console.error(`import-cairn: malformed JSON in ${into}`); process.exitCode = 1; return; }
  } else {
    dst = { version: 1, projects: {} };
  }
  let imported = 0;
  for (const [project, bucket] of Object.entries(src.projects ?? {})) {
    const target = (dst.projects[project] ??= { markers: [] });
    const existing = new Set(target.markers.map((m: { id: string }) => m.id));
    for (const m of bucket.markers as { id: string }[]) {
      if (!existing.has(m.id)) {
        target.markers.push(m);
        imported++;
      }
    }
  }
  mkdirSync(dirname(into), { recursive: true });
  writeFileSync(into, JSON.stringify(dst, null, 2) + "\n");
  console.log(`imported ${imported} marker(s) from ${from} into ${into}`);
}
