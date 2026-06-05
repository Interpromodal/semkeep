/**
 * Greenlight report — GREEN decision + human/JSON renderers.
 *
 * Ported from C:/Users/john/.claude/tools/greenlight/greenlight/report.py
 *
 * The GREEN rule: all required (non-optional, non-skipped) checks must pass.
 * Optional checks can fail without blocking; skipped checks do not count.
 *
 * stdout/stderr evidence is tailed to 1200 chars to avoid flooding output.
 */
import type { Report, CheckResult, RunResult } from "./types.js";

// Status labels deliberately ASCII — never crashes a legacy Windows console.
const PASS = "[PASS]";
const FAIL = "[FAIL]";
const WARN = "[WARN]";
const SKIP = "[SKIP]";

const EVIDENCE_TAIL = 1200; // chars of captured output to show as evidence on failure

/**
 * Tail a string to `limit` chars. Prepends a truncation marker if trimmed.
 * Mirrors report.py's _tail().
 */
function tail(text: string, limit = EVIDENCE_TAIL): string {
  if (text.length <= limit) return text;
  return "...(truncated)...\n" + text.slice(-limit);
}

/**
 * Indent every line of text with a prefix string.
 * Mirrors report.py's _indent().
 */
function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

/**
 * Returns true iff the report is GREEN.
 * Mirrors report.py's Report.green property.
 */
export function isGreen(r: Report): boolean {
  return r.green;
}

/**
 * Render the report in human-readable form.
 * Mirrors report.py's render_human().
 *
 * Format:
 *   Greenlight: <name>
 *   (blank line)
 *   [PASS]/[FAIL]/[WARN]/[SKIP]  <check name>  (optional)
 *     on failure: run cmd + exit code + duration, failing assertions + detail
 *                 stdout/stderr tails
 *   (blank line)
 *   X/Y required checks passed - GREEN | NOT GREEN
 *   (N optional check(s) failed - not blocking)   ← if any
 */
export function renderHuman(r: Report, verbose = false): string {
  const lines: string[] = [`Greenlight: ${r.name ?? "(unnamed)"}`, ""];

  for (const c of r.checks) {
    if (c.skipped) {
      lines.push(`  ${SKIP} ${c.name}`);
      continue;
    }
    const tag = c.passed ? PASS : c.optional ? WARN : FAIL;
    const suffix = c.optional ? " (optional)" : "";
    lines.push(`  ${tag} ${c.name}${suffix}`);

    // Show detail on failure (or always when verbose).
    if (!c.passed || verbose) {
      if (c.result !== undefined && c.run !== undefined) {
        const runCmd = Array.isArray(c.run) ? c.run.join(" ") : c.run;
        let meta = `exit ${c.result.exit_code}, ${Math.round(c.result.duration_ms)}ms`;
        if (c.result.timed_out) meta += ", TIMED OUT";
        lines.push(`         run: ${runCmd}  (${meta})`);
      }
      for (const a of c.assertions) {
        const mark = a.ok ? "ok" : "FAIL";
        let line = `         - [${mark}] ${a.summary}`;
        if (a.detail && !a.ok) line += `: ${a.detail}`;
        lines.push(line);
      }
      // Show stdout/stderr tails for failed checks that ran a command.
      if (!c.passed && c.result !== undefined) {
        for (const streamName of ["stdout", "stderr"] as const) {
          const text = c.result[streamName];
          if (text.trim()) {
            lines.push(`         ${streamName} (tail):`);
            lines.push(indent(tail(text), "           | "));
          }
        }
      }
    }
  }

  lines.push("");
  const verdict = r.green ? "GREEN" : "NOT GREEN";
  lines.push(`${r.required_passed}/${r.required_total} required checks passed - ${verdict}`);

  // Count optional failures for the footer.
  const optFailed = r.checks.filter((c) => c.optional && !c.skipped && !c.passed);
  if (optFailed.length) {
    lines.push(`(${optFailed.length} optional check(s) failed - not blocking)`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON render helpers (mirror report.py's _run_to_dict / report_to_dict)
// ---------------------------------------------------------------------------

function runToDict(result: RunResult | undefined): Record<string, unknown> | null {
  if (result === undefined) return null;
  return {
    exit_code: result.exit_code,
    duration_ms: Math.round(result.duration_ms * 1000) / 1000,
    timed_out: result.timed_out,
    stdout_tail: tail(result.stdout),
    stderr_tail: tail(result.stderr),
  };
}

function checkToDict(c: CheckResult): Record<string, unknown> {
  const runCmd = c.run !== undefined
    ? (Array.isArray(c.run) ? c.run.join(" ") : c.run)
    : "";
  return {
    name: c.name,
    ok: c.passed,
    optional: c.optional,
    skipped: c.skipped,
    run_cmd: runCmd,
    note: "",
    run: runToDict(c.result),
    assertions: c.assertions.map((a) => ({
      type: a.type,
      ok: a.ok,
      summary: a.summary,
      detail: a.detail ?? null,
    })),
  };
}

/**
 * Render the report as a structured object suitable for JSON.stringify.
 * Mirrors report.py's report_to_dict() + render_json().
 *
 * Top-level: { name, green, required_total, required_passed, results: [...] }
 * Per-check: { name, ok, optional, skipped, run_cmd, note, run, assertions }
 * Per-run: { exit_code, duration_ms, timed_out, stdout_tail, stderr_tail }
 */
export function renderJson(r: Report): unknown {
  return {
    name: r.name ?? null,
    green: r.green,
    required_total: r.required_total,
    required_passed: r.required_passed,
    cwd: ".",
    results: r.checks.map(checkToDict),
  };
}
