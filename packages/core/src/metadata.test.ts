import { describe, expect, it } from "vitest";
import { findMetadataLine, restoreMetadataLine, setMetadataLine } from "./metadata.js";

const doc = ["# auth", "", "## R1: Sign in", "priority: must", "status: approved", "", "Body text.", "status: not metadata", ""].join("\n");

describe("setMetadataLine", () => {
  it("replaces the value of an existing key, changing no other line", () => {
    const { text, previous } = setMetadataLine(doc, 3, "status", "removed");
    expect(previous).toBe("status: approved");
    expect(text).toBe(doc.replace("status: approved", "status: removed"));
  });

  it("inserts a missing key right after the heading", () => {
    const { text, previous } = setMetadataLine(doc, 3, "drift-ack", "abc");
    expect(previous).toBeNull();
    expect(text.split("\n").slice(2, 6)).toEqual(["## R1: Sign in", "drift-ack: abc", "priority: must", "status: approved"]);
  });

  it("only looks in the metadata block under the heading", () => {
    const lines = doc.split("\n");
    expect(findMetadataLine(lines, 3, "status")).toEqual({ headingEnd: 2, index: 4 });
    expect(findMetadataLine(lines, 3, "owner")).toEqual({ headingEnd: 2 });
  });

  it("keeps the key's spacing, trailing whitespace and CRLF endings", () => {
    const crlf = "## R1: A\r\ndrift-ack:   old  \r\nstatus: approved\r\n";
    expect(setMetadataLine(crlf, 1, "drift-ack", "new").text).toBe("## R1: A\r\ndrift-ack:   new  \r\nstatus: approved\r\n");
    expect(setMetadataLine("## R1: A\r\nstatus: x\r\n", 1, "drift-ack", "h").text).toBe("## R1: A\r\ndrift-ack: h\r\nstatus: x\r\n");
    expect(setMetadataLine("## R1: A\nstatus:x\n", 1, "status", "y").text).toBe("## R1: A\nstatus: y\n");
  });

  it("treats a setext underline as part of the heading", () => {
    expect(setMetadataLine("R1: A\n-----\nstatus: x\n", 1, "drift-ack", "h").text).toBe("R1: A\n-----\ndrift-ack: h\nstatus: x\n");
  });
});

describe("restoreMetadataLine", () => {
  it("puts the line back exactly, or removes one that was inserted", () => {
    const set = setMetadataLine(doc, 3, "status", "removed");
    expect(restoreMetadataLine(set.text, 3, "status", set.previous)).toBe(doc);
    const inserted = setMetadataLine(doc, 3, "drift-ack", "abc");
    expect(restoreMetadataLine(inserted.text, 3, "drift-ack", inserted.previous)).toBe(doc);
  });

  it("is undefined when the line to put back is gone", () => {
    expect(restoreMetadataLine("## R1: A\n", 1, "status", "status: todo")).toBeUndefined();
    expect(restoreMetadataLine("## R1: A\n", 1, "status", null)).toBe("## R1: A\n");
  });
});
