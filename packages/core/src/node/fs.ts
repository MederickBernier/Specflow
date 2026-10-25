import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FileSystem, ListDirOptions } from "../fs.js";

/** {@link FileSystem} over the local disk. */
export class NodeFileSystem implements FileSystem {
  readFile(path: string): Promise<string> {
    return readFile(path, "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async size(path: string): Promise<number> {
    return (await stat(path)).size;
  }

  async listDir(path: string, options: ListDirOptions = {}): Promise<string[]> {
    if (!options.directoriesOnly) {
      return (await readdir(path)).sort();
    }
    const names: string[] = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      // A symlink counts when it points to a directory.
      if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(join(path, entry.name))))) {
        names.push(entry.name);
      }
    }
    return names.sort();
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
