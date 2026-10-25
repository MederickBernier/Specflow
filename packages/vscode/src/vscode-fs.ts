import { type FileSystem, type ListDirOptions, toPosixPath } from "@specflow/core";
import * as vscode from "vscode";

/** The `core` path for a file URI: its file system path with forward slashes. */
export function corePath(uri: vscode.Uri): string {
  return toPosixPath(uri.fsPath);
}

/** {@link FileSystem} over `vscode.workspace.fs`, for `file:` workspaces. */
export class VsCodeFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path)));
  }

  async writeFile(path: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(path);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path));
      return true;
    } catch {
      return false;
    }
  }

  async size(path: string): Promise<number> {
    return (await vscode.workspace.fs.stat(vscode.Uri.file(path))).size;
  }

  async listDir(path: string, options: ListDirOptions = {}): Promise<string[]> {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(path));
    return entries
      .filter(([, type]) => !options.directoriesOnly || (type & vscode.FileType.Directory) !== 0)
      .map(([name]) => name)
      .sort();
  }
}
