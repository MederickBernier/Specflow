import { posix } from "node:path";

/**
 * File access injected into `core`. Paths are absolute.
 *
 * - `readFile` rejects when the file does not exist.
 * - `writeFile` creates missing parent directories.
 * - `exists` is true for files and directories.
 * - `listDir` returns entry names (files and directories), sorted, and
 *   rejects when the directory does not exist.
 */
export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listDir(path: string): Promise<string[]>;
}

/** In-memory {@link FileSystem} for tests. Directories exist implicitly when they contain a file. */
export class MemoryFileSystem implements FileSystem {
  readonly #files = new Map<string, string>();

  /** Creates the file system with `files`, a map of absolute path to content. */
  constructor(files: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(files)) {
      this.#files.set(normalize(path), content);
    }
  }

  async readFile(path: string): Promise<string> {
    const content = this.#files.get(normalize(path));
    if (content === undefined) {
      throw new Error(`ENOENT: no such file: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.#files.set(normalize(path), content);
  }

  async exists(path: string): Promise<boolean> {
    const key = normalize(path);
    return this.#files.has(key) || this.#children(key).length > 0;
  }

  async listDir(path: string): Promise<string[]> {
    const children = this.#children(normalize(path));
    if (children.length === 0) {
      throw new Error(`ENOENT: no such directory: ${path}`);
    }
    return children;
  }

  #children(dir: string): string[] {
    const prefix = dir === "/" ? "/" : `${dir}/`;
    const names = new Set<string>();
    for (const key of this.#files.keys()) {
      if (key.startsWith(prefix)) {
        names.add(key.slice(prefix.length).split("/")[0]!);
      }
    }
    return [...names].sort();
  }
}

function normalize(path: string): string {
  const normalized = posix.normalize(path);
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
