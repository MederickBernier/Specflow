import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRequirements } from "./requirements.js";

const options = { file: "/repo/.specs/auth/requirements.md", feature: "auth", prefix: "R" };

const sample = `# auth: requirements

Intro text is not part of any requirement.

## R1: Sign in with \`email\`
priority: must
status: approved
owner: someone

Users sign in with their email.

### Notes

Still part of R1.

- Given a registered user
- When they submit the right
  password
- then they are signed in
- And a \`session\` cookie is set
- Not a criterion
- Givenly not a criterion either

## R2: Lock out
status: approved

- Given five failures
  - nested bullets are not criteria
- Then the account is locked


## R3 Missing colon
status: approved

## Requirements overview

Not an item, but it still ends the item before it.

## R4: Draft with no metadata

\`\`\`md
## R9: Inside a code fence
\`\`\`
`;

function parse(markdown: string = sample, opts = options) {
  return parseRequirements(markdown, opts);
}

describe("parseRequirements", () => {
  // core-spec-model/R1
  it("turns each valid heading into a requirement, in order", () => {
    expect(parse().requirements.map((r) => [r.id, r.title])).toEqual([
      ["R1", "Sign in with `email`"],
      ["R2", "Lock out"],
      ["R4", "Draft with no metadata"],
    ]);
  });

  it("maps known metadata lines to fields", () => {
    const [r1, r2] = parse().requirements;
    expect(r1).toMatchObject({ feature: "auth", priority: "must", status: "approved" });
    expect(r2!.priority).toBeUndefined();
  });

  it("captures Given/When/Then/And bullets as criteria", () => {
    const [r1, r2] = parse().requirements;
    expect(r1!.criteria).toEqual([
      { keyword: "Given", text: "a registered user" },
      { keyword: "When", text: "they submit the right password" },
      { keyword: "Then", text: "they are signed in" },
      { keyword: "And", text: "a `session` cookie is set" },
    ]);
    expect(r2!.criteria).toEqual([
      { keyword: "Given", text: "five failures" },
      { keyword: "Then", text: "the account is locked" },
    ]);
  });

  it("keeps the body as markdown without the heading and metadata lines", () => {
    const body = parse().requirements[0]!.body;
    expect(body.startsWith("Users sign in with their email.")).toBe(true);
    expect(body).toContain("### Notes");
    expect(body).toContain("- Given a registered user");
    expect(body).not.toContain("priority:");
    expect(body.endsWith("- Givenly not a criterion either")).toBe(true);
  });

  it("only reads metadata directly under the heading", () => {
    const [r] = parse("## R1: Title\n\nstatus: approved\n").requirements;
    expect(r!.status).toBe("draft");
    expect(r!.body).toBe("status: approved");
  });

  it("defaults status to draft when it is missing", () => {
    expect(parse().requirements[2]!.status).toBe("draft");
  });

  it("uses the configured prefix", () => {
    const { requirements } = parse("## REQ7: Custom prefix\n## R1: Ignored\n", { ...options, prefix: "REQ" });
    expect(requirements.map((r) => r.id)).toEqual(["REQ7"]);
  });

  it("ignores headings inside code fences", () => {
    expect(parse().requirements.map((r) => r.id)).not.toContain("R9");
  });

  it("accepts setext level 2 headings and CRLF line endings", () => {
    const { requirements } = parse("R1: Setext\r\n---\r\nstatus: approved\r\n");
    expect(requirements[0]).toMatchObject({ id: "R1", title: "Setext", status: "approved" });
    expect(requirements[0]!.location).toMatchObject({ startLine: 1, endLine: 3 });
  });

  // core-spec-model/R4
  it("records the file and 1-based line range of each requirement", () => {
    const [r1, r2, r4] = parse().requirements;
    expect(r1!.location).toEqual({ file: options.file, startLine: 5, endLine: 22 });
    expect(r2!.location).toEqual({ file: options.file, startLine: 24, endLine: 29 });
    expect(r4!.location).toEqual({ file: options.file, startLine: 39, endLine: 43 });
  });

  it("reports a malformed ID heading with its location and skips it", () => {
    const { requirements, findings } = parse();
    expect(requirements.map((r) => r.id)).not.toContain("R3");
    expect(findings).toEqual([
      {
        rule: "malformed-heading",
        severity: "error",
        message: 'Heading "R3 Missing colon" looks like an ID but does not match "## R<n>: <title>"',
        location: { file: options.file, startLine: 32, endLine: 32 },
        feature: "auth",
      },
    ]);
  });

  // core-spec-model/R8
  it("keeps unknown metadata keys in extra without failing", () => {
    expect(parse().requirements[0]!.extra).toEqual({ owner: "someone" });
  });

  it("keeps unrecognized priority and status values in extra", () => {
    const [r] = parse("## R1: Typos\npriority: urgent\nstatus: aproved\n").requirements;
    expect(r!.priority).toBeUndefined();
    expect(r!.status).toBe("draft");
    expect(r!.extra).toEqual({ priority: "urgent", status: "aproved" });
  });

  it("never fails on free-form content", () => {
    const { requirements, findings } = parse("Just prose.\n\n> quote\n\n| a | b |\n\n## R1: Ok\n\n<div>html</div>\n");
    expect(requirements.map((r) => r.id)).toEqual(["R1"]);
    expect(findings).toEqual([]);
  });

  it("parses the clean fixture", () => {
    const path = fileURLToPath(new URL("../../../../fixtures/specs/clean/.specs/accounts/requirements.md", import.meta.url));
    const { requirements, findings } = parseRequirements(readFileSync(path, "utf8"), { ...options, file: path });
    expect(findings).toEqual([]);
    expect(requirements.map((r) => [r.id, r.status, r.priority])).toEqual([
      ["R1", "approved", "must"],
      ["R2", "approved", "should"],
      ["R3", "draft", "could"],
      ["R4", "removed", undefined],
    ]);
    expect(requirements[0]!.extra).toEqual({ owner: "someone" });
    expect(requirements[0]!.criteria).toHaveLength(4);
  });
});
