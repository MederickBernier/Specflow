# core-spec-model: design

## Overview

A pure function pipeline in `@specflow/core`:

```
FileSystem -> findRoot -> loadConfig -> listFeatures -> parseFile (remark AST) -> SpecTree -> lint -> Finding[]
```

No caching in v1. The tree is small; reparsing on every call keeps things simple and correct.

## Types

```ts
type Location = { file: string; startLine: number; endLine: number };

type Criterion = { keyword: "Given" | "When" | "Then" | "And"; text: string };

type Requirement = {
  feature: string;
  id: string;                 // "R3"
  title: string;
  priority?: "must" | "should" | "could";
  status: "draft" | "approved" | "removed";
  body: string;               // markdown, metadata lines removed
  criteria: Criterion[];      // Given/When/Then bullets, in order
  extra: Record<string, string>;
  location: Location;
};

type Task = {
  feature: string;
  id: string;                 // "T2"
  title: string;
  reqs: string[];             // ["R3", "R4"]
  status: "todo" | "doing" | "done" | "blocked";
  files: string[];
  depends: string[];
  body: string;
  extra: Record<string, string>;
  location: Location;
};

type Feature = {
  name: string;
  dir: string;
  requirements: Requirement[];
  tasks: Task[];
  design?: { markdown: string; location: Location };
};

type Config = {
  version: 1;
  specsDir: string;
  harness: { default: string; adapters: Record<string, { extraArgs: string[] }> };
  ids: { requirement: string; task: string };
  commit: { mode: "staged" | "auto"; trailers: boolean };
  drift: { llm: boolean; ignore: string[] };
};

type SpecTree = { root: string; config: Config; features: Feature[] };

type Finding = {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  location: Location;
  feature: string;
  id?: string;
};
```

## Parsing

- Use remark to get an mdast with positions. Only level 2 headings define items; everything until the next level 2 heading belongs to that item.
- Heading regex: `^(R|T)(\d+):\s*(.+?)(?:\s*\[([^\]]*)\])?$`, prefixes taken from config.
- Metadata: the first consecutive lines matching `^([a-z][a-z-]*):\s*(.*)$` right after the heading. Known keys map to fields, others go to `extra`.
- Criteria: list items whose text starts with `Given`, `When`, `Then`, `And` (case-insensitive).
- A level 2 heading that starts with the ID prefix but fails the regex produces a `malformed-heading` finding and is skipped.

## Lint

Each rule is a function `(tree: SpecTree) => Finding[]` registered in a list. Rules are independent and run in a fixed order so output is stable.

| Rule | Severity |
| --- | --- |
| `malformed-heading` | error |
| `duplicate-id` | error |
| `unknown-ref` | error |
| `dependency-cycle` | error |
| `orphan-requirement` | warning |

## Config

Validated with zod. Defaults live in one `defaultConfig` constant, merged deeply with the file.

`Config` is the normalized form: in the file, adapter settings sit next to `harness.default` (`harness.claude-code.extraArgs`); the loader collects every key other than `default` into `harness.adapters`.

The file is always `<root>/.specs/config.yml`; `specsDir` only moves the feature folders. Each schema key is optional, so the file is validated before the merge and every invalid key is reported at once as `<dotted.key>: <expected type>`. Unknown keys are ignored.

## Interfaces

```ts
interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listDir(path: string, options?: { directoriesOnly?: boolean }): Promise<string[]>;
}
```

Paths are absolute. `readFile` rejects on a missing file, `writeFile` creates parent directories, `exists` is true for files and directories, `listDir` returns sorted entry names (only subdirectories with `directoriesOnly`, which is how the loader finds feature folders) and rejects on a missing directory.

A Node implementation lives in `core/node`. Tests use an in-memory implementation.

## CLI surface

- `specflow init [--force]`
- `specflow lint [--json]`, exit code 1 when any error is found
- `specflow show <feature>[/<id>] [--json]`

## Alternatives considered

- **YAML front matter per item:** more rigid, harder for humans to write. Rejected.
- **A JSON spec file next to the markdown:** two sources of truth. Rejected.
