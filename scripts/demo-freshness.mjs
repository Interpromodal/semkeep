// Acceptance: add / edit / delete files, then a single freshen reflects all
// three — no manual index_path. (Lexical embedder = fast.)
import { Store } from "../dist/store.js";
import { indexPath } from "../dist/indexer.js";
import { freshen } from "../dist/freshen.js";
import { LexicalEmbedder } from "../dist/embeddings/lexical.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = mkdtempSync(join(tmpdir(), "semkeep-fresh-"));
writeFileSync(join(repo, "auth.ts"), "export function login(){ return 'in' }\n");
writeFileSync(join(repo, "old.ts"), "export function legacy(){ return 'old' }\n");

const store = await Store.load(mkdtempSync(join(tmpdir(), "semkeep-fresh-data-")));
const emb = new LexicalEmbedder(256);
store.setEmbedderMeta(emb.name, emb.dim);
await indexPath(store, emb, repo);
console.log(`indexed: ${store.stats().symbolCount} symbols, ${store.stats().fileCount} files`);

writeFileSync(join(repo, "billing.ts"), "export function charge(){ return 42 }\n");                                    // ADD
writeFileSync(join(repo, "auth.ts"), "export function login(){ return 'in' }\nexport function logout(){ return 'x' }\n"); // EDIT
rmSync(join(repo, "old.ts"));                                                                                          // DELETE

const r = await freshen(store, emb);
console.log(`freshen: +${r.added} new, ${r.reindexed} changed, -${r.pruned} pruned (scanned ${r.scanned}) in ${r.elapsedMs}ms\n`);

const show = (name, expect) => {
  const found = store.findDefinitions(name).length > 0;
  console.log(`  define(${name}) -> ${found ? "found" : "not found"}   ${found === expect ? "OK" : "FAIL"}`);
};
show("charge", true);   // added file
show("logout", true);   // edited file (new symbol)
show("legacy", false);  // deleted file (pruned)
