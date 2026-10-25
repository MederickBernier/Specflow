import { describe, expect, it } from "vitest";
import { parseStatus } from "./git-status.js";

describe("parseStatus", () => {
  it("parses -z output, including renames and spaces", () => {
    expect(parseStatus(" M src/a.ts\0?? new file.ts\0R  b.ts\0old b.ts\0D  gone.ts\0")).toEqual([
      { code: " M", path: "src/a.ts" },
      { code: "??", path: "new file.ts" },
      { code: "R ", path: "b.ts", from: "old b.ts" },
      { code: "D ", path: "gone.ts" },
    ]);
  });

  it("returns nothing for a clean tree", () => {
    expect(parseStatus("")).toEqual([]);
  });
});
