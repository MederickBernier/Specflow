import { parse, YAMLParseError } from "yaml";
import { z } from "zod";
import type { FileSystem } from "./fs.js";
import type { Config } from "./model.js";
import { joinPath } from "./paths.js";
import { err, ok, type Result } from "./result.js";

/** Path of the config file, relative to the repo root. */
export const configPath = ".specs/config.yml";

/** Values used for every key `config.yml` leaves out, or when the file is missing. */
export const defaultConfig: Config = {
  version: 1,
  specsDir: ".specs",
  harness: { default: "claude-code", adapters: {} },
  ids: { requirement: "R", task: "T" },
  commit: { mode: "staged", trailers: true },
  drift: { llm: false, ignore: ["**/*.md", "**/__snapshots__/**"] },
};

/** Why `config.yml` could not be loaded. `issues` has one entry per invalid key. */
export type ConfigError = {
  file: string;
  message: string;
  issues: { key: string; message: string }[];
};

const idPrefix = z.string().regex(/^[A-Za-z]+$/, "Invalid input: expected letters only");

const adapterSchema = z.object({
  extraArgs: z.array(z.string()).default([]),
});

// Every key is optional: the file is validated first, then merged over defaultConfig.
const fileSchema = z.object({
  version: z.literal(1).optional(),
  specsDir: z.string().min(1).optional(),
  harness: z
    .object({ default: z.string().min(1).optional() })
    .catchall(adapterSchema)
    .optional(),
  ids: z.object({ requirement: idPrefix.optional(), task: idPrefix.optional() }).optional(),
  commit: z
    .object({ mode: z.enum(["staged", "auto"]).optional(), trailers: z.boolean().optional() })
    .optional(),
  drift: z.object({ llm: z.boolean().optional(), ignore: z.array(z.string()).optional() }).optional(),
});

/**
 * Parses the text of `config.yml` and merges it over {@link defaultConfig}.
 * An empty file yields the defaults. `file` is only used in error messages.
 */
export function parseConfig(text: string, file: string = configPath): Result<Config, ConfigError> {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      return err({ file, message: `${file}: ${error.message}`, issues: [] });
    }
    throw error;
  }

  const parsed = fileSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      key: issue.path.length > 0 ? issue.path.join(".") : "(root)",
      message: issue.message,
    }));
    const lines = issues.map((issue) => `  ${issue.key}: ${issue.message}`);
    return err({ file, message: [`${file} is invalid:`, ...lines].join("\n"), issues });
  }

  const { harness, ids, commit, drift, specsDir } = parsed.data;
  const { default: defaultHarness, ...adapters } = harness ?? {};
  const base = structuredClone(defaultConfig);
  return ok({
    version: 1,
    specsDir: specsDir ?? base.specsDir,
    harness: {
      default: defaultHarness ?? base.harness.default,
      adapters: { ...base.harness.adapters, ...adapters },
    },
    ids: { ...base.ids, ...ids },
    commit: { ...base.commit, ...commit },
    drift: { ...base.drift, ...drift },
  });
}

/**
 * Loads `<root>/.specs/config.yml`. A missing file is not an error: the
 * defaults are returned.
 */
export async function loadConfig(fs: FileSystem, root: string): Promise<Result<Config, ConfigError>> {
  const file = joinPath(root, configPath);
  if (!(await fs.exists(file))) {
    return ok(structuredClone(defaultConfig));
  }
  return parseConfig(await fs.readFile(file), file);
}
