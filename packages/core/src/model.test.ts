import { describe, expect, expectTypeOf, it } from "vitest";
import type { Finding, Location, Requirement, Task } from "./model.js";

const location: Location = { file: "/repo/.specs/auth/requirements.md", startLine: 3, endLine: 9 };

describe("model", () => {
  // core-spec-model/R4: requirements, tasks and findings carry file and 1-based line range.
  it("gives every item and finding a location", () => {
    expectTypeOf<Location>().toEqualTypeOf<{ file: string; startLine: number; endLine: number }>();
    expectTypeOf<Requirement["location"]>().toEqualTypeOf<Location>();
    expectTypeOf<Task["location"]>().toEqualTypeOf<Location>();
    expectTypeOf<Finding["location"]>().toEqualTypeOf<Location>();
  });

  // core-spec-model/R8: unknown metadata keys are kept in an `extra` map.
  it("keeps unknown metadata in extra", () => {
    expectTypeOf<Requirement["extra"]>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<Task["extra"]>().toEqualTypeOf<Record<string, string>>();

    const requirement: Requirement = {
      feature: "auth",
      id: "R1",
      title: "Sign in",
      status: "approved",
      body: "",
      criteria: [{ keyword: "Given", text: "a user" }],
      extra: { owner: "someone" },
      location,
    };
    expect(requirement.extra.owner).toBe("someone");
  });
});
