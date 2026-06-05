/**
 * Greenlight public API — re-exports the complete surface.
 *
 * Import from here in tools.ts and any consumer outside the greenlight module.
 */
export { loadSpec, validateSpec, SpecError } from "./spec.js";
export { runSpec } from "./runner.js";
export { lintSpec } from "./strict.js";
export { renderHuman, renderJson, isGreen } from "./report.js";
export type { Spec, Report, Check, CheckResult, Assertion, AssertionResult, RunResult } from "./types.js";
export type { StrictWarning } from "./strict.js";
export type { RunOpts } from "./runner.js";
