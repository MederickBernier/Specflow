# core-spec-model: design

## Overview

A pure function pipeline in `@specflow/core`:

```
FileSystem -> findRoot -> loadConfig -> listFeatures -> parseFile (remark AST) -> SpecTree -> lint -> Finding[]
```

No caching in v1. The tree is small; reparsing on every call keeps things simple and correct.

- `findRoot` walks up from the start directory to the nearest folder containing `.specs/`, stopping at a folder containing `.git`, so a repo without specs never picks up a parent repo's.
- Features are the non-hidden subfolders of `specsDir`, in folder-name order. `requirements.md`, `tasks.md` and `design.md` are each optional.
- `loadSpecTree(fs, from)` returns `Result<SpecTree, LoadError>`, where `LoadError.kind` is `no-specs`, `invalid-config` or `missing-specs-dir`.

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
  findings: Finding[];        // from parsing, e.g. malformed-heading
};

type Config = {
  version: 1;
  specsDir: string;
  harness: { default: string; adapters: Record<string, { extraArgs: string[] }> };
  ids: { requirement: string; task: string };
  commit: { mode: "staged" | "auto"; trailers: boolean };
  drift: { llm: boolean; llmBytes: number; ignore: string[] };
};

type SpecTree = { root: string; config: Config; features: Feature[] };

type Finding = {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  location: Location;
  feature: string;
  id?: string;
  evidence?: { file?: string; commit?: string; subject?: string };  // drift findings
  verdict?: { verdict: "holds" | "broken" | "unsure"; reason: string };  // optional LLM pass
};
```

## Parsing

- Use remark to get an mdast with positions. Only level 2 headings define items; everything until the next level 2 heading belongs to that item.
- Heading regex: `^(R|T)(\d+):\s*(.+?)(?:\s*\[([^\]]*)\])?$`, prefixes taken from config.
- Metadata: the first consecutive lines matching `^([a-z][a-z-]*):\s*(.*)$` right after the heading. Known keys map to fields, others go to `extra`.
- Criteria: list items whose text starts with `Given`, `When`, `Then`, `And` (case-insensitive).
- A level 2 heading that starts with the ID prefix and a digit (`R3 ...`) but fails the regex produces a `malformed-heading` finding and is skipped. Other level 2 headings (`## Requirements overview`) are not items but still end the item before them.
- Markdown is parsed with `mdast-util-from-markdown`, the parser behind `remark-parse`. Titles and criteria text are sliced from the source, so inline markdown such as backticks is kept.
- Metadata must start on the line directly after the heading. `body` is the rest of the item with leading blank lines removed. An item's `endLine` is its last non-blank line.
- A missing or unrecognized `status` becomes `draft`, an unrecognized `priority` is left unset, and the raw value goes to `extra`, so a typo never breaks parsing. Tasks do the same with `todo` as the default status.
- A task heading without a `[...]` list has no references, the same as `[]`. `files` and `depends` are split on commas and kept as written (`T2`, `task-run/T7`, globs).
- Shared splitting lives in `parse/items.ts`; the requirements and tasks parsers only map metadata to fields. Parsers return `{ items, findings }`, where `findings` holds `malformed-heading`.

## Lint

Each rule is a function `(tree: SpecTree) => Finding[]` registered in a list. `malformed-heading` is detected while parsing, since the bad heading never becomes an item; the loader stores those findings on `Feature.findings` and the rule returns them. Rules are independent and run in a fixed order so output is stable.

| Rule | Severity |
| --- | --- |
| `malformed-heading` | error |
| `duplicate-id` | error |
| `unknown-ref` | error |
| `dependency-cycle` | error |
| `orphan-requirement` | warning |

- Findings point at the item's heading line. Each has `feature` and, except `malformed-heading`, the item `id`.
- References and `depends` resolve `R3` in the task's own feature and `other/R3` in `other`.
- `duplicate-id` checks requirement and task IDs separately and reports every use after the first.
- `unknown-ref` reports each unknown requirement in a task's bracket list. Unknown `depends` targets are not reported in v1; `dependency-cycle` ignores them.
- `dependency-cycle` reports one finding per cycle (strongly connected component, or a task depending on itself), on the cycle's first task in tree order, with the path in the message.
- `orphan-requirement` counts references from tasks in any feature.

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
  size(path: string): Promise<number>;
  listDir(path: string, options?: { directoriesOnly?: boolean }): Promise<string[]>;
}
```

Paths are absolute. `readFile` rejects on a missing file, `writeFile` creates parent directories, `exists` is true for files and directories, `size` is a file's length in bytes and rejects on a missing file (added for workbench-ui, so large untracked files are skipped before they are read), `listDir` returns sorted entry names (only subdirectories with `directoriesOnly`, which is how the loader finds feature folders) and rejects on a missing directory.

A Node implementation lives in `core/node`. Tests use an in-memory implementation.

## CLI surface

- `specflow init [--force] [--json]`, exit code 1 when it refuses

`initSpecs(fs, dir, { force })` lives in `core`. Templates are string constants in `core/src/templates/`, so bundles need no asset files. It refuses when `findRoot` finds a spec root at or above `dir`; with `force` it writes only the missing template files into that root. Existing files are never overwritten. The example feature passes lint.
- `specflow lint [--json]`, exit code 1 when any error is found
- `specflow show <feature>[/<id>] [--json]`, exit code 1 when the target does not exist

Shared by every command:

- Exit codes: 0 success (warnings allowed), 1 the command's own failure, 2 specs could not be loaded or bad usage.
- Paths in text and JSON are relative to the repo root, with forward slashes.
- JSON output is one document with a `schema` field (`specflow.lint/v1`, `specflow.show/v1`); failures print `{ schema, error: { kind, message } }`.
- Commands take an injected `Io` (cwd, `FileSystem`, stdout, stderr), so tests run them in-process against the fixture repos.

## Alternatives considered

- **YAML front matter per item:** more rigid, harder for humans to write. Rejected.
- **A JSON spec file next to the markdown:** two sources of truth. Rejected.
