// Files written by `specflow init`, keyed by path relative to the repo root.
// Kept as strings so bundles (the VS Code extension) need no asset files.
// The result must pass lint; templates.test.ts checks it.

const readme = `# Specs

This project is built spec first. Every change starts here.

## Layout

\`\`\`
.specs/
  README.md      # this file: conventions
  product.md     # steering: what we build, for whom, and what we don't
  tech.md        # steering: stack, architecture rules, coding conventions
  config.yml     # tool config
  <feature>/
    requirements.md   # R1, R2, ... with acceptance criteria
    design.md         # how it will be built
    tasks.md          # T1, T2, ... each referencing requirements
\`\`\`

Steering files apply to every feature. Feature folders are scoped to one capability.

## ID rules

- Requirements are \`R<n>\`, tasks are \`T<n>\`, numbered per feature.
- A full reference is \`<feature>/<id>\`, for example \`example/R1\`.
- IDs are never reused. A removed requirement keeps its heading with \`status: removed\`.
- A task lists the requirements it satisfies in brackets: \`## T3: Parse task headings [R2, R4]\`.
- Setup and enabling work uses an empty list: \`## T1: Set up CI []\`.
- \`depends\` lists task IDs in the same feature (\`T2\`) or in another one (\`other/T7\`).

## Requirement format

\`\`\`markdown
## R3: Short imperative title
priority: must | should | could
status: draft | approved | removed

Free-text intent, one or two sentences.

- Given <context>
- When <action>
- Then <observable outcome>
\`\`\`

## Task format

\`\`\`markdown
## T2: Short imperative title [R1, R3]
status: todo | doing | done | blocked
files: src/path/one.ts, src/path/two.ts
depends: T1

What "done" means for this task, in one or two sentences.
\`\`\`

## Commit trailers

Every commit that implements a task carries:

\`\`\`
Spec-Feature: example
Spec-Task: T1
Spec-Req: R1
\`\`\`

## Workflow

1. Write or update \`requirements.md\`, set \`status: approved\` when it is ready.
2. Write \`design.md\`.
3. Break it into \`tasks.md\`.
4. Implement one task at a time, commit with trailers, mark it \`done\`.
5. If the code needs to diverge from the spec, change the spec in the same commit.
`;

const product = `# Product

## Vision

One or two sentences: what this is and why it should exist.

## Users

- **Primary:** who uses it, and what they are trying to get done.

## Non-goals

- What this deliberately does not do.

## Success criteria

- How you will know it works.
`;

const tech = `# Tech

## Stack

- Language, runtime, frameworks, test tools.

## Architecture rules

- Rules every change must follow, for example which modules may depend on which.

## Conventions

- Naming, error handling, formatting.

## Testing

- What gets tested, and how.
`;

const config = `version: 1

specsDir: .specs

harness:
  default: claude-code
  claude-code:
    # Passed through to the harness. Leave empty to use the harness defaults.
    extraArgs: []

ids:
  requirement: R
  task: T

commit:
  mode: staged        # staged | auto
  trailers: true

drift:
  llm: false          # optional second pass through the harness
  ignore:
    - "**/*.md"
    - "**/__snapshots__/**"
`;

const exampleRequirements = `# example: requirements

An example feature. Rename the folder, or delete it once you have your own.

## R1: Greet the user
priority: must
status: approved

Say hello on start so the user knows the app is running.

- Given the app starts
- When no name is configured
- Then it prints "Hello, world"
`;

const exampleDesign = `# example: design

## Overview

How the feature will be built: components, data flow, and the alternatives you rejected.
`;

const exampleTasks = `# example: tasks

## T1: Print the greeting [R1]
status: todo
files: src/main.ts

Starting the app prints "Hello, world"; a test covers it.
`;

/** Every file `init` writes, keyed by path relative to the repo root, in write order. */
export const specTemplates: Readonly<Record<string, string>> = {
  ".specs/README.md": readme,
  ".specs/product.md": product,
  ".specs/tech.md": tech,
  ".specs/config.yml": config,
  ".specs/example/requirements.md": exampleRequirements,
  ".specs/example/design.md": exampleDesign,
  ".specs/example/tasks.md": exampleTasks,
};
