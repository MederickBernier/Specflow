# core-spec-model: tasks

## T1: Set up the monorepo and CI []
status: done
files: package.json, pnpm-workspace.yaml, tsconfig.base.json, .github/workflows/ci.yml

Four packages exist, `pnpm build` and `pnpm test` pass locally and in CI. No requirement yet; this unblocks everything.

## T2: Build the fixture repo generator []
status: done
files: fixtures/build.ts, fixtures/specs/**
depends: T1

A script creates fixture repos with one clean spec tree and one broken tree per lint rule. Run before tests.

## T3: Define core types and FileSystem interface [R4, R8]
status: done
files: packages/core/src/model.ts, packages/core/src/fs.ts, packages/core/src/node/fs.ts
depends: T1

Types from the design compile, with a Node and an in-memory FileSystem implementation.

## T4: Load and validate config [R6]
status: done
files: packages/core/src/config.ts, packages/core/src/result.ts
depends: T3

Missing file returns defaults, invalid values return an error naming the key.

## T5: Parse requirements files [R1, R4, R8]
status: done
files: packages/core/src/parse/requirements.ts, packages/core/src/parse/items.ts
depends: T3

Unit tests cover metadata, criteria, unknown keys and line ranges.

## T6: Parse tasks files [R2, R4, R8]
status: done
files: packages/core/src/parse/tasks.ts
depends: T3

Unit tests cover references, empty reference lists, files, depends and line ranges.

## T7: Load the full spec tree [R3]
status: done
files: packages/core/src/load.ts
depends: T4, T5, T6

Loading from a nested directory finds the root and returns all features from the clean fixture.

## T8: Implement lint rules [R5]
status: done
files: packages/core/src/lint/**
depends: T7, T2

Each broken fixture produces exactly its expected finding; the clean fixture produces none.

## T9: CLI lint and show commands [R5]
status: done
files: packages/cli/src/commands/lint.ts, packages/cli/src/commands/show.ts, packages/cli/src/program.ts, packages/cli/src/output.ts, packages/cli/src/index.ts
depends: T8

Text and `--json` output covered by snapshots, exit code 1 on errors.

## T10: CLI init command [R7]
status: todo
files: packages/cli/src/commands/init.ts, packages/core/src/templates/**
depends: T9

`init` then `lint` passes; a second `init` refuses without `--force` and never overwrites.

## T11: Support Windows and WSL paths []
status: done
files: packages/core/src/paths.ts, .github/workflows/ci.yml, .gitattributes, fixtures/build.ts
depends: T7

Core accepts drive and UNC paths from any shell; CI builds and tests on Linux and Windows.
