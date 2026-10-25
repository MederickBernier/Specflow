import { describe, expect, it } from "vitest";
import { commitBody, extractSpecNotes } from "./spec-notes.js";

describe("extractSpecNotes", () => {
  // task-run/R12
  it.each([
    "Spec notes:",
    "## Spec notes",
    "**Spec notes:**",
    "**Spec notes**:",
    "spec notes",
  ])("splits at %j", (heading) => {
    const reply = `Added the counter.\n\nAll tests pass.\n\n${heading}\n- The test command in tech.md fails on Node 24.\n- R4 does not say what unknown flags do;\n  I made them exit 2.\n`;
    expect(extractSpecNotes(reply)).toEqual({
      summary: "Added the counter.\n\nAll tests pass.",
      notes: ["The test command in tech.md fails on Node 24.", "R4 does not say what unknown flags do; I made them exit 2."],
    });
  });

  it("accepts a note on the heading line and numbered items", () => {
    expect(extractSpecNotes("Done.\nSpec notes: design.md names a missing module.\n1. Another one\n").notes).toEqual([
      "design.md names a missing module.",
      "Another one",
    ]);
  });

  it("drops a 'none' note", () => {
    expect(extractSpecNotes("Done.\n\nSpec notes: none\n")).toEqual({ summary: "Done.", notes: [] });
    expect(extractSpecNotes("Done.\n\nSpec notes:\n- None.\n").notes).toEqual([]);
  });

  it("returns the whole reply when there are no notes", () => {
    expect(extractSpecNotes("  Done, nothing to add.  \n")).toEqual({ summary: "Done, nothing to add.", notes: [] });
  });

  it("does not split on a sentence that merely mentions spec notes", () => {
    expect(extractSpecNotes("I have no spec notes this time.").notes).toEqual([]);
  });
});

describe("commitBody", () => {
  // task-run/R6: first paragraph, without spec notes.
  it("keeps the first paragraph only", () => {
    expect(commitBody("Added the counter.\nIt resets after 15 minutes.\n\n**Files:**\n- src/a.ts\n\nSpec notes:\n- x")).toBe(
      "Added the counter.\nIt resets after 15 minutes.",
    );
  });

  it("drops a reply that is only spec notes, and a missing summary", () => {
    expect(commitBody("Spec notes:\n- x")).toBeUndefined();
    expect(commitBody(undefined)).toBeUndefined();
    expect(commitBody("   ")).toBeUndefined();
  });
});
