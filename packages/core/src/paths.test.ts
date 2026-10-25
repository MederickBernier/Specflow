import { describe, expect, it } from "vitest";
import { joinPath, parentDir, toPosixPath } from "./paths.js";

describe("toPosixPath", () => {
  it.each([
    ["/home/me/repo", "/home/me/repo"],
    ["/home/me/repo/", "/home/me/repo"],
    ["/home/me/./repo/src/..", "/home/me/repo"],
    ["/", "/"],
    ["C:\\Users\\me\\repo", "C:/Users/me/repo"],
    ["C:\\Users\\me\\repo\\", "C:/Users/me/repo"],
    ["C:\\", "C:/"],
    ["c:/repo", "c:/repo"],
    ["\\\\wsl$\\Ubuntu\\home\\me\\repo", "//wsl$/Ubuntu/home/me/repo"],
    ["\\\\wsl.localhost\\Ubuntu\\home\\me", "//wsl.localhost/Ubuntu/home/me"],
    ["//server/share/a/../b/", "//server/share/b"],
  ])("%j -> %j", (input, expected) => {
    expect(toPosixPath(input)).toBe(expected);
  });
});

describe("joinPath", () => {
  it.each([
    [["/repo", ".specs", "config.yml"], "/repo/.specs/config.yml"],
    [["C:/repo", ".specs"], "C:/repo/.specs"],
    [["C:/", ".specs"], "C:/.specs"],
    [["//wsl$/Ubuntu/repo", ".specs/a"], "//wsl$/Ubuntu/repo/.specs/a"],
    [["/repo", "docs/specs"], "/repo/docs/specs"],
    [["/", ".specs"], "/.specs"],
    [["/", ".specs", "config.yml"], "/.specs/config.yml"],
    [["C:\\", ".specs"], "C:/.specs"],
  ])("%j -> %j", ([base, ...segments], expected) => {
    expect(joinPath(base!, ...segments)).toBe(expected);
  });
});

describe("parentDir", () => {
  it.each([
    ["/repo/src", "/repo"],
    ["/repo", "/"],
    ["/", undefined],
    ["C:/repo/src", "C:/repo"],
    ["C:/repo", "C:/"],
    ["C:/", undefined],
    ["//wsl$/Ubuntu/home/me", "//wsl$/Ubuntu/home"],
    ["//wsl$/Ubuntu/home", "//wsl$/Ubuntu"],
    ["//wsl$/Ubuntu", undefined],
  ])("%j -> %j", (input, expected) => {
    expect(parentDir(input)).toBe(expected);
  });
});
