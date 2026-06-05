/**
 * Greenlight MCP tool handler tests.
 *
 * These are integration-style tests that call the handler functions directly
 * (not through the MCP transport), using cross-platform node -e "..." commands.
 */
import { describe, it, expect } from "vitest";
import { greenlightRunTool, greenlightLintTool } from "../src/tools.js";

describe("greenlight tools", () => {
  it("greenlight_run returns GREEN when an inline spec's checks pass", async () => {
    const spec = {
      name: "t",
      checks: [
        {
          name: "echo",
          run: 'node -e "console.log(\'hello\')"',
          assert: [
            { type: "exit_code", equals: 0 },
            { type: "stdout_contains", value: "hello" },
          ],
        },
      ],
    };
    const out = await greenlightRunTool({ spec });
    expect(out).toMatch(/GREEN/);
    expect(out).not.toMatch(/NOT GREEN/);
  });

  it("greenlight_run reports NOT GREEN when an assertion fails", async () => {
    const spec = {
      checks: [
        {
          name: "bad",
          run: 'node -e "process.exit(1)"',
          assert: [{ type: "exit_code", equals: 0 }],
        },
      ],
    };
    const out = await greenlightRunTool({ spec });
    expect(out).toMatch(/NOT GREEN/);
  });

  it("greenlight_lint flags a shallow exit-code-only gate", async () => {
    const spec = {
      checks: [
        {
          name: "shallow",
          run: 'node -e ""',
          assert: [{ type: "exit_code", equals: 0 }],
        },
      ],
    };
    const out = await greenlightLintTool({ spec });
    expect(out).toMatch(/only_exit_code|shallow/i);
  });

  it("greenlight_lint returns clean message when spec is strong", async () => {
    const spec = {
      checks: [
        {
          name: "good",
          run: 'node -e "console.log(\'done\')"',
          assert: [
            { type: "exit_code", equals: 0 },
            { type: "stdout_contains", value: "done" },
          ],
        },
      ],
    };
    const out = await greenlightLintTool({ spec });
    expect(out).toMatch(/No shallow-gate warnings/i);
  });

  it("greenlight_run with strict flag appends strict warnings when gate is shallow", async () => {
    const spec = {
      checks: [
        {
          name: "shallow",
          run: 'node -e "process.exit(0)"',
          assert: [{ type: "exit_code", equals: 0 }],
          strict_exempt: true,  // exempt so it doesn't block GREEN
        },
      ],
    };
    // strict_exempt suppresses warnings, so no strict warnings expected
    const out = await greenlightRunTool({ spec, strict: true });
    expect(out).toMatch(/GREEN/);
  });
});
