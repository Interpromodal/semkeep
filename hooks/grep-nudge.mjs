#!/usr/bin/env node
// PreToolUse(Grep) companion for mind-palace.
// If a Grep pattern reads like a natural-language *concept* query, inject a
// brief note suggesting the mind-palace `search` tool (meaning-based) instead.
// Stays silent for exact strings / regex. ALWAYS exits 0 — never blocks Grep.

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw);
    const pattern = input?.tool_input?.pattern ?? "";
    if (looksLikeConcept(pattern)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext:
              "Note: this Grep pattern reads like a concept query. If the current project is indexed in mind-palace, prefer its `search` tool — it finds code by meaning (e.g. \"retry logic\" surfaces `backoffScheduler`). Keep using Grep for exact strings or regex.",
          },
        }),
      );
    }
  } catch {
    // Malformed input or any error: stay silent, never disrupt Grep.
  }
  process.exit(0);
});

/** True only for prose-like queries: >=3 plain words, no regex/code characters. */
function looksLikeConcept(p) {
  if (typeof p !== "string") return false;
  const s = p.trim();
  if (s.length < 15) return false; // too terse to be a concept query
  if (/[\\()\[\]{}|+?^$*=<>/:;@#&"']/.test(s)) return false; // regex/code -> exact search
  const tokens = s.split(/\s+/);
  if (tokens.length < 3) return false;
  const words = tokens.filter((t) => /^[A-Za-z][A-Za-z-]*$/.test(t) && t.length >= 2);
  return words.length >= 3 && words.length >= tokens.length - 1;
}
