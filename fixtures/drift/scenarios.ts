// Drift fixture repos, one commit list each. Built by drift/build.ts into
// fixtures/repos/drift-<name>; expected findings are in <name>.expected.json.

/** Hashes of earlier steps, by step name, for content that refers to a commit. */
export type Hashes = Record<string, string>;

/** One commit: files to write (or delete with `null`) and its message. */
export type Step = {
  name?: string;
  message: string;
  files: Record<string, string | null | ((hashes: Hashes) => string)>;
};

export type Scenario = { name: string; description: string; steps: Step[] };

const trailers = (task: string, reqs: string) => `\n\nSpec-Feature: auth\nSpec-Task: ${task}\nSpec-Req: ${reqs}\n`;

const requirements = (extra: { r1Meta?: string; r2Criteria?: string; r3?: boolean } = {}) => `# auth: requirements

## R1: Sign in
priority: must
status: approved
${extra.r1Meta ?? ""}
- Given a registered user
- When they sign in with the right password
- Then they are signed in

## R2: Sign out
priority: must
status: approved

- Given a signed-in user
- When they sign out
- Then the session ends
${extra.r2Criteria ?? ""}${
  extra.r3
    ? `
## R3: Reset password
priority: should
status: approved

- Given a user who forgot their password
- When they ask for a reset
- Then they get a reset link
`
    : ""
}`;

const tasks = (r3 = false) => `# auth: tasks

## T1: Sign in [R1]
status: done
files: src/login.ts

## T2: Sign out [R2]
status: done
files: src/logout.ts
${
  r3
    ? `
## T3: Reset password [R3]
status: done
files: src/reset.ts
`
    : ""
}`;

const specs = (r3 = false): Step => ({
  message: "docs(specs): auth feature",
  files: {
    ".specs/config.yml": "version: 1\n",
    ".specs/product.md": "# Product\n\nA login service used as a drift fixture.\n",
    ".specs/auth/requirements.md": requirements({ r3 }),
    ".specs/auth/tasks.md": tasks(r3),
    "README.md": "# auth service\n",
  },
});

// Implementation of R1 and R2 with trailers, then unrelated changes that must not cause findings.
const history: Step[] = [
  { message: `feat(auth): Sign in${trailers("T1", "R1")}`, files: { "src/login.ts": "export const login = () => true;\n" } },
  { message: `feat(auth): Sign out${trailers("T2", "R2")}`, files: { "src/logout.ts": "export const logout = () => true;\n" } },
  { message: "docs: describe setup", files: { "README.md": "# auth service\n\nRun `npm start`.\n" } },
  { message: "test: sign in", files: { "test/login.test.ts": "// covers login\n" } },
];

const fix: Step = {
  name: "fix",
  message: "fix: reject empty passwords",
  files: { "src/login.ts": "export const login = (password: string) => password.length > 0;\n" },
};

export const driftScenarios: Scenario[] = [
  {
    name: "clean",
    description: "Every requirement implemented with trailers; later commits touch nothing traced.",
    steps: [specs(), ...history],
  },
  {
    name: "code-changed-since-spec",
    description: "R1's file changes in a commit without trailers, after R1's text last changed.",
    steps: [specs(), ...history, fix],
  },
  {
    name: "spec-changed-since-code",
    description: "R2's text changes after its last trace commit, and no code follows.",
    steps: [
      specs(),
      ...history,
      {
        message: "docs(specs): sign out ends every session\n\nSpec-Feature: auth\nSpec-Task: none\nSpec-Req: none\n",
        files: { ".specs/auth/requirements.md": requirements({ r2Criteria: "- And every other session of that user ends too\n" }) },
      },
    ],
  },
  {
    name: "unimplemented",
    description: "R3 is approved and its task is done, but no commit references R3.",
    steps: [
      specs(true),
      ...history,
      { message: "feat: password reset", files: { "src/reset.ts": "export const reset = () => true;\n" } },
    ],
  },
  {
    name: "acked",
    description: "The code-changed-since-spec fix, acknowledged with drift-ack on R1.",
    steps: [
      specs(),
      ...history,
      fix,
      {
        message: "docs(specs): acknowledge the empty password fix",
        files: { ".specs/auth/requirements.md": (hashes) => requirements({ r1Meta: `drift-ack: ${hashes.fix}\n` }) },
      },
    ],
  },
  {
    name: "out-of-scope",
    description: "R1's commit also adds src/session.ts, outside T1's files; a later change to it must not flag R1.",
    steps: [
      specs(),
      {
        message: `feat(auth): Sign in${trailers("T1", "R1")}`,
        files: { "src/login.ts": "export const login = () => true;\n", "src/session.ts": "export const sessions = new Map();\n" },
      },
      ...history.slice(1),
      { message: "refactor: session store", files: { "src/session.ts": "export const sessions = new Map<string, number>();\n" } },
    ],
  },
];
