// Removes machine and account details from a raw Claude Code stream-json
// recording so it can be committed as a fixture. Everything else is kept as
// recorded, line for line.
//
//   node fixtures/streams/sanitize.ts <raw.jsonl> <out.jsonl> <recorded cwd>
//
// See docs/spikes/claude-code-headless.md for how recordings are made.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";

const [raw, out, cwd] = process.argv.slice(2);
if (!raw || !out || !cwd) {
  console.error("usage: node fixtures/streams/sanitize.ts <raw.jsonl> <out.jsonl> <recorded cwd>");
  process.exit(2);
}

const user = userInfo().username;
let text = readFileSync(raw, "utf8")
  .replaceAll(cwd, "/work/toy")
  .replaceAll(homedir(), "/home/user")
  .replaceAll(`-home-${user}-`, "-home-user-");

// Plan usage and local socket paths say nothing about the stream format.
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => {
      if (key === "utilization" && typeof v === "number") return [key, 0];
      if (key === "messaging_socket_path" && typeof v === "string") return [key, "/run/user/1000/cc-socks/0.sock"];
      return [key, scrub(v)];
    }),
  );
}

text = text
  .split("\n")
  .map((line) => (line.trim() === "" ? line : JSON.stringify(scrub(JSON.parse(line)))))
  .join("\n");

if (text.includes(user)) {
  console.error(`${out}: still contains "${user}"; extend sanitize.ts before committing`);
  process.exit(1);
}
writeFileSync(out, text);
