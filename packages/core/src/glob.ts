/**
 * Whether `path` matches `pattern`. Both use forward slashes. `*` and `?`
 * stay within one path segment, `**` spans segments (`a/**\/b` also matches
 * `a/b`), and a pattern ending in `/` matches everything below it. Other
 * characters, including `.`, `[` and `{`, are literal.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path.replace(/^\.\//, ""));
}

function globToRegExp(pattern: string): RegExp {
  let glob = pattern.trim().replace(/^\.\//, "");
  if (glob.endsWith("/")) glob += "**";
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}
