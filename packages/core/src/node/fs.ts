import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileSystem } from "../fs.js";

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

  async listDir(path: string): Promise<string[]> {
    return (await readdir(path)).sort();
  }
}
