// Manual end-to-end smoke test: launch the built MCP server over stdio with a
// real MCP client, list tools, and exercise index_path / search / remember /
// recall / status. Forces the lexical embedder so it runs offline.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "mp-smoke-data-"));
const repo = mkdtempSync(join(tmpdir(), "mp-smoke-repo-"));
mkdirSync(join(repo, "src"));
writeFileSync(
  join(repo, "src", "net.ts"),
  "export function backoffScheduler(){ /* exponential retry after failures */ }\n",
);
writeFileSync(
  join(repo, "src", "ui.ts"),
  "export function renderLoginButton(){ /* paints the button blue */ }\n",
);

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/server.js"],
  env: { ...process.env, SEMKEEP_EMBEDDER: "lexical", SEMKEEP_DATA_DIR: dataDir },
});
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).sort().join(", "));

const callText = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return res.content.map((c) => c.text).join("\n");
};

console.log("\n--- index_path ---\n" + (await callText("index_path", { path: repo })));
console.log("\n--- search 'retry backoff logic' ---\n" + (await callText("search", { query: "where is the retry backoff logic", k: 2 })));
console.log("\n--- remember ---\n" + (await callText("remember", { text: "this project uses the lexical fallback embedder in CI", tags: ["ci"] })));
console.log("\n--- recall 'which embedder in tests' ---\n" + (await callText("recall", { query: "which embedder runs in tests" })));
console.log("\n--- status ---\n" + (await callText("status")));

await client.close();
console.log("\nSMOKE OK");
