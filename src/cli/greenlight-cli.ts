// Placeholder — implemented in Task 4
import { writeFileSync, existsSync } from "node:fs";
import { loadSpec, runSpec, lintSpec, renderHuman, renderJson } from "../greenlight/index.js";

const STARTER = {
  name: "my-gate",
  checks: [
    {
      name: "tests",
      run: "npm test",
      assert: [
        { type: "exit_code", equals: 0 },
        { type: "stdout_contains", value: "pass" },
      ],
    },
  ],
};

export async function runGreenlightCli(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === "init") {
    const path = rest[0] ?? "greenlight.json";
    if (existsSync(path)) {
      console.error(`refusing to overwrite ${path}`);
      process.exitCode = 1;
      return;
    }
    writeFileSync(path, JSON.stringify(STARTER, null, 2) + "\n");
    console.log(`wrote ${path}`);
    return;
  }
  const specPath = rest.find((a) => !a.startsWith("--"));
  if (!specPath) {
    console.error("usage: semkeep greenlight <run|lint|init> <spec.json>");
    process.exitCode = 2;
    return;
  }
  let spec;
  try {
    spec = loadSpec({ specPath });
  } catch (e) {
    console.error(String((e as Error).message));
    process.exitCode = 2;
    return;
  }
  if (sub === "lint") {
    const w = lintSpec(spec);
    console.log(
      w.length
        ? w.map((x) => `[${x.check}] (${x.rule}) ${x.message}`).join("\n")
        : "no shallow-gate warnings",
    );
    return;
  }
  if (sub === "run") {
    const json = rest.includes("--json");
    const strict = rest.includes("--strict");
    const onlyIdx = rest.indexOf("--only");
    const only =
      onlyIdx >= 0
        ? rest.slice(onlyIdx + 1).filter((a) => !a.startsWith("--"))
        : undefined;
    const report = runSpec(spec, { only });
    console.log(json ? JSON.stringify(renderJson(report), null, 2) : renderHuman(report));
    process.exitCode = report.green ? 0 : 1;
    if (strict && process.exitCode === 0 && lintSpec(spec).length) process.exitCode = 1;
    return;
  }
  console.error(`unknown greenlight subcommand "${sub}"`);
  process.exitCode = 2;
}
