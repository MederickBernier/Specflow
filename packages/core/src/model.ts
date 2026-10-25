/** A span of lines in a file. Lines are 1-based and inclusive. */
export type Location = { file: string; startLine: number; endLine: number };

/** One Given/When/Then/And bullet of a requirement, in source order. */
export type Criterion = { keyword: "Given" | "When" | "Then" | "And"; text: string };

/** A `## R<n>: <title>` item from a feature's `requirements.md`. */
export type Requirement = {
  feature: string;
  id: string;
  title: string;
  priority?: "must" | "should" | "could";
  status: "draft" | "approved" | "removed";
  /** Markdown body with the metadata lines removed. */
  body: string;
  criteria: Criterion[];
  /** Metadata lines with keys the model does not know, kept verbatim. */
  extra: Record<string, string>;
  location: Location;
};

/** A `## T<n>: <title> [R1, R2]` item from a feature's `tasks.md`. */
export type Task = {
  feature: string;
  id: string;
  title: string;
  /** Requirement IDs from the heading's bracket list, in order. */
  reqs: string[];
  status: "todo" | "doing" | "done" | "blocked";
  files: string[];
  /** Task IDs in the same feature (`T2`) or another one (`task-run/T7`). */
  depends: string[];
  body: string;
  extra: Record<string, string>;
  location: Location;
};

/** One folder under the specs directory. */
export type Feature = {
  name: string;
  dir: string;
  requirements: Requirement[];
  tasks: Task[];
  design?: { markdown: string; location: Location };
};

/** Settings for one harness adapter, from `harness.<name>` in `config.yml`. */
export type AdapterConfig = { extraArgs: string[] };

/**
 * Validated `config.yml`, normalized. In the file, adapter settings sit next
 * to `harness.default`; here they are collected under `harness.adapters`.
 */
export type Config = {
  version: 1;
  specsDir: string;
  harness: { default: string; adapters: Record<string, AdapterConfig> };
  ids: { requirement: string; task: string };
  commit: { mode: "staged" | "auto"; trailers: boolean };
  drift: { llm: boolean; ignore: string[] };
};

/** Everything loaded from one repo's specs directory. */
export type SpecTree = { root: string; config: Config; features: Feature[] };

/** A problem reported by lint or drift check. */
export type Finding = {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  location: Location;
  feature: string;
  id?: string;
};
