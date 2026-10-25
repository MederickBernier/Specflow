# Recorded patches

Real `git` output for the unified diff parser (`packages/core/src/diff/`), recorded with the arguments `readWorkingDiff` and `readCommitDiff` use:

- `working.patch`: `git diff HEAD --no-color --no-ext-diff --no-textconv -M -U3 --relative --src-prefix=a/ --dst-prefix=b/` over a staged change set with a modification in two hunks, an added, a deleted and a binary file, a rename with and without edits, a mode change, a file that gained its final newline, and paths with a space, a tab and a non-ASCII letter.
- `root-commit.patch`: `git show --format=` with the same options, on the root commit those files came from.

Keep the trailing tab after `with space.txt` in the `---` and `+++` lines: git writes it for names that contain a space.
