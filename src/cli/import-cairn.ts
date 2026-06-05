// Placeholder — implemented in Task 5
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

function flag(a: string[], n: string): string | undefined {
  const i = a.indexOf(n);
  return i >= 0 ? a[i + 1] : undefined;
}

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
  const src = JSON.parse(readFileSync(from, "utf8")) as {
    projects?: Record<string, { markers: unknown[] }>;
  };
  const dst = existsSync(into)
    ? JSON.parse(readFileSync(into, "utf8"))
    : { version: 1, projects: {} };
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
