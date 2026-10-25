import { describe, expect, it } from "vitest";
import { matchesGlob } from "./glob.js";

describe("matchesGlob", () => {
  it.each([
    ["src/cli.ts", "src/cli.ts", true],
    ["src/cli.ts", "./src/cli.ts", true],
    ["src/clixts", "src/cli.ts", false],
    ["src/cli.ts", "src/*.ts", true],
    ["src/run/cli.ts", "src/*.ts", false],
    ["src/run/cli.ts", "src/**", true],
    ["src/run/deep/cli.ts", "src/**/*.ts", true],
    ["src/cli.ts", "src/**/*.ts", true],
    ["test/cli.test.ts", "src/**", false],
    ["fixtures/streams/a.jsonl", "fixtures/streams/*.jsonl", true],
    ["packages/core/src/lint/rules/x.ts", "packages/core/src/lint/**", true],
    ["src/a1.ts", "src/a?.ts", true],
    ["src/a12.ts", "src/a?.ts", false],
    ["src/run/x.ts", "src/run/", true],
    ["src/[id].ts", "src/[id].ts", true],
    ["src/i.ts", "src/[id].ts", false],
  ])("%s against %s is %s", (path, pattern, expected) => {
    expect(matchesGlob(path, pattern)).toBe(expected);
  });
});
