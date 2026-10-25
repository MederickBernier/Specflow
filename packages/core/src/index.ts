export type { FileSystem, ListDirOptions } from "./fs.js";
export { MemoryFileSystem } from "./fs.js";
export type {
  AdapterConfig,
  Config,
  Criterion,
  Feature,
  Finding,
  Location,
  Requirement,
  SpecTree,
  Task,
} from "./model.js";
export type { ConfigError } from "./config.js";
export { configPath, defaultConfig, loadConfig, parseConfig } from "./config.js";
export { joinPath, parentDir, toPosixPath } from "./paths.js";
export type { Result } from "./result.js";
export { err, ok } from "./result.js";
export type { LoadError } from "./load.js";
export { findRoot, loadSpecTree } from "./load.js";
export type { ParseOptions } from "./parse/items.js";
export { parseRequirements } from "./parse/requirements.js";
export { parseTasks } from "./parse/tasks.js";
export type { LintRule } from "./lint/lint.js";
export { lint, lintRules } from "./lint/lint.js";
export { fullRef, resolveRef } from "./lint/refs.js";
export type { InitError, InitResult } from "./init.js";
export { initSpecs } from "./init.js";
export { specTemplates } from "./templates/templates.js";
export type { Clock } from "./clock.js";
export { FakeClock } from "./clock.js";
export type { FakeGitResponse, Git, GitCall, GitError } from "./git.js";
export { FakeGit, GitCommandError, gitError } from "./git.js";
export { AsyncQueue, LineSplitter } from "./queue.js";
export type { ProcessExit, ProcessScript, SpawnCall, SpawnedProcess, Spawner } from "./spawner.js";
export { FakeProcess, FakeSpawner } from "./spawner.js";
export type {
  HarnessAdapter,
  HarnessCheck,
  HarnessCheckError,
  RunInput,
  UnknownAdapterError,
} from "./run/adapter.js";
export { AdapterRegistry } from "./run/adapter.js";
export type { RunEvent } from "./run/events.js";
export { eventSequenceProblems, parseRunEvent, runEventKinds } from "./run/events.js";
export type { ReplayOptions, ReplaySource, Sleep } from "./run/replay-adapter.js";
export { parseEventStream, ReplayAdapter } from "./run/replay-adapter.js";
export type { PromptError } from "./run/prompt.js";
export { buildTaskPrompt } from "./run/prompt.js";
export type { StatusEntry } from "./git-status.js";
export { gitStatus, parseStatus } from "./git-status.js";
export type { RunError, RunHandle, RunnerDeps, RunRequest } from "./run/runner.js";
export { cancelGraceMs, startRun } from "./run/runner.js";
export type { RecordError, Recording, RunOutcome } from "./run/recorder.js";
export { changedFiles, messageFileName, recordRun } from "./run/recorder.js";
export type { StatusError, StatusSnapshot } from "./run/status.js";
export { restoreTaskStatus, setTaskStatus, tasksFile } from "./run/status.js";
export type { CommitFile, TraceCommit } from "./trace/commits.js";
export { historyLogArgs, parseHistory, parseTraceLog, readHistory, readTraceCommits, traceLogArgs } from "./trace/commits.js";
export type { FeatureTrace, RequirementTrace, TaskTrace, Trace, TracedTask, TraceError } from "./trace/trace.js";
export { trace } from "./trace/trace.js";
export type { SplitReply } from "./run/spec-notes.js";
export { commitBody, extractSpecNotes } from "./run/spec-notes.js";
export { matchesGlob } from "./glob.js";
export type { ScopeReport } from "./run/scope.js";
export { checkScope } from "./run/scope.js";
export type { DriftIndex, RequirementIndex } from "./drift/index.js";
export { buildDriftIndex } from "./drift/index.js";
export type { SpecChange } from "./drift/spec-history.js";
export { lastSpecChange } from "./drift/spec-history.js";
export type { DriftContext, DriftRule } from "./drift/context.js";
export { buildDriftContext } from "./drift/context.js";
export { codeChangedSinceSpec } from "./drift/rules/code-changed.js";
export { specChangedSinceCode } from "./drift/rules/spec-changed.js";
export { unimplemented } from "./drift/rules/unimplemented.js";
export { checkDrift, driftRules } from "./drift/check.js";
export { suppressAcked } from "./drift/suppress.js";
export type { LlmDeps } from "./drift/llm.js";
export { llmPass, llmPrompt, parseVerdict } from "./drift/llm.js";
export type { RunTaskError, RunTaskHooks, RunTaskResult } from "./run/run-task.js";
export { runTask } from "./run/run-task.js";
export type { ReviewError, StagedRecording } from "./run/review.js";
export { acceptRecording, discardRecording } from "./run/review.js";
export type { DiffHunk, DiffLine, FileDiff } from "./diff/unified.js";
export { parseUnifiedDiff, unquotePath } from "./diff/unified.js";
export type { DiffResult } from "./diff/read.js";
export { diffLimits, emptyTree, readCommitDiff, readWorkingDiff } from "./diff/read.js";
