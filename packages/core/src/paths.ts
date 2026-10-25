import { posix } from "node:path";

// Paths inside core are absolute and use forward slashes: `/home/me/repo`,
// `C:/repo`, or UNC `//wsl$/Ubuntu/home/me/repo`. node:path's posix helpers
// collapse the leading `//` of UNC paths, so core goes through these instead.

const uncRoot = /^\/\/[^/]+\/[^/]+$/;

/**
 * Converts a path from the OS or an editor to core's form: backslashes become
 * slashes, `.` and `..` segments are resolved, and a trailing slash is
 * dropped except on a root. UNC prefixes are kept.
 */
export function toPosixPath(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const unc = /^\/\/[^/]/.test(slashed);
  let normalized = posix.normalize(slashed);
  if (unc) normalized = `/${normalized.replace(/^\/+/, "/")}`;
  if (normalized.length > 1 && normalized.endsWith("/") && !/^[A-Za-z]:\/$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** Joins path segments onto `base`, keeping a UNC prefix. */
export function joinPath(base: string, ...segments: string[]): string {
  // A root base ("/" or "C:/") already ends in a slash; adding another would read as a UNC prefix.
  const root = toPosixPath(base);
  return toPosixPath(`${root}${root.endsWith("/") ? "" : "/"}${segments.join("/")}`);
}

/** Parent directory of `path`, or undefined when `path` is a root (`/`, `C:/`, `//server/share`). */
export function parentDir(path: string): string | undefined {
  const dir = toPosixPath(path);
  if (dir === "/" || /^[A-Za-z]:\/?$/.test(dir) || uncRoot.test(dir)) return undefined;
  const parent = posix.dirname(dir);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}/`;
  return dir.startsWith("//") ? `/${parent.replace(/^\/+/, "/")}` : parent;
}
