# Spike: Claude Code headless output

Task: `task-run/T1`. Recorded 2026-10-25 against Claude Code **2.1.310** on Linux (WSL), model `claude-haiku-5-5`. Total cost of the recordings: about $0.01.

## Command

```
claude -p --output-format stream-json --verbose \
  --permission-mode acceptEdits --allowedTools "Bash(node hello.js)" \
  [--max-turns N] [--model <model>]
```

- `-p` (print mode) reads the prompt from **stdin** when no prompt argument is given. Pass it there; never on the command line.
- `--output-format stream-json` requires `--verbose`. Output is one JSON object per line on stdout. Stderr was empty in every run.
- `--max-turns` works but is not listed in `--help` in this version.
- `--permission-mode acceptEdits` lets Write and Edit run without prompts. Without an allow rule, Bash is denied (there is nobody to ask in print mode) and the run continues.
- Spawned with an argument array, no shell. The adapter adds `config.harness.claude-code.extraArgs` after its own flags.

Recordings also used `--setting-sources project --strict-mcp-config --no-session-persistence` so the author's user hooks, plugins and MCP servers did not leak into the fixtures. The adapter should **not** pass these: users expect their own settings, permissions and MCP servers to apply (the reason the design prefers the CLI over the Agent SDK).

## Exit codes

| Run | Exit | Last line |
| --- | --- | --- |
| Success | 0 | `result` with `subtype: "success"`, `is_error: false` |
| `--max-turns 1` reached | 1 | `result` with `subtype: "error_max_turns"`, `is_error: true`, `errors: ["Reached maximum number of turns (1)"]` |
| SIGTERM mid tool call | 143 (signal reported as exit code) | **no `result` line**; the process exited about 0.4 s after the signal |

## Event types seen

Every line has `type`; most have `session_id` and `uuid`.

| `type` / `subtype` | Contents used | Notes |
| --- | --- | --- |
| `system` / `init` | `session_id`, `model`, `cwd`, `permissionMode`, `claude_code_version`, `tools` | Always first. Also lists slash commands, skills, plugins and local paths. |
| `rate_limit_event` | `rate_limit_info.status` | Plan usage. Drop. |
| `assistant` | `message.content[]`: one block per line, `text`, `tool_use` or `thinking` | `tool_use` has `id`, `name`, `input`. `thinking` arrived with empty text and a signature. |
| `user` | `message.content[]` of `tool_result` (`tool_use_id`, `content`, `is_error`), plus `tool_use_result` | `tool_use_result` is structured: Write `{ type: "create" \| "update", filePath, content }`, Edit `{ filePath, oldString, newString, structuredPatch, ... }`, Bash `{ stdout, stderr, interrupted }`. On a denial it is a plain string. |
| `system` / `permission_denied` | `tool_name`, `tool_use_id`, `message` | Emitted when a tool call is refused. |
| `system` / `thinking_tokens` | `estimated_tokens` | Progress only. Drop. |
| `result` | `subtype`, `is_error`, `result` (final text), `errors[]`, `num_turns`, `duration_ms`, `total_cost_usd`, `usage`, `permission_denials[]` | Last line of a run that was not killed. |

Tool inputs use **absolute paths** (`file_path`). Bash `command` is what the model typed; Claude Code may prefix `cd <cwd> &&` internally (seen in `wire_tool_inputs`).

## Findings that change the adapter

1. **Files change outside Edit and Write.** In `claude-code-bash-write.jsonl` the model created `hello.js` with `printf ... > hello.js && node hello.js`, and Claude Code approved the compound command against the `Bash(node hello.js)` allow rule. No Write event exists for that file. The `git status` pass after exit (already in the design) is required, not a fallback.
2. **A run can succeed while a tool was denied.** In `claude-code-success.jsonl` the model ran `node /work/toy/hello.js` (absolute path), which does not match `Bash(node hello.js)` literally, so it was denied; the run still ended `subtype: "success"`. Denials must surface as non-fatal `error` events so the user sees them.
3. **Cancelling yields no `result`.** The adapter must emit `finished { ok: false, cancelled: true }` itself after SIGTERM, and `usage` is unknown for a cancelled run.
4. **Write can overwrite.** `tool_use_result.type` tells `create` from `update`, so `file-changed.change` should come from the `user` line, not the `tool_use` line.

## Proposed mapping to `RunEvent` (for T6)

| Claude Code | `RunEvent` |
| --- | --- |
| `system/init` | `started { runId: session_id, harness: "claude-code", at: <clock> }` |
| `assistant` `text` block | `message { role: "assistant", text }` |
| `assistant` `tool_use` block | `tool-call { tool: name, summary }`, summary = path relative to cwd for file tools, `command` for Bash, else `description` or the tool name. Bash also emits `command { command }`. |
| `user` `tool_result` for Write/Edit/NotebookEdit, not an error | `file-changed { path (relative), change }`: Write `create` → `added`, `update` → `modified`; Edit → `modified` |
| `system/permission_denied` | `error { fatal: false, message: "Permission denied: <tool>: <message>" }` |
| `result` | `usage { inputTokens: input + cache_creation + cache_read, outputTokens, costUsd: total_cost_usd, durationMs: duration_ms }`, then `error { fatal: true }` per entry of `errors[]` when `is_error`, then `finished { ok: !is_error, summary: result }` |
| exit without `result`, not cancelled | `error { fatal: true, message: "claude exited with code N" }` + `finished { ok: false }` |
| after exit | `file-changed` for paths in `git status --porcelain` not already reported |
| `rate_limit_event`, `system/thinking_tokens`, `thinking` blocks, unknown types | dropped |

## Health check (`check()`)

- `claude --version` prints `2.1.310 (Claude Code)`; parse the leading semver. A missing binary surfaces as `exit.error.code === "ENOENT"` from the `Spawner`.
- `claude auth status --json` (JSON is the default) returns `{ loggedIn, authMethod, apiProvider, email, orgId, orgName, subscriptionType, ... }`. Use only `loggedIn`; never log or store the rest.
- Tested range to pin: `>=2.1.0 <3` (only 2.1.310 actually tested). Outside it, `check()` warns.

## Not verified

- **Logged out.** `auth status` output and run behavior while logged out were not recorded (it would have signed the author out). Assumed: `loggedIn: false`.
- **Windows.** Not run. An npm install puts `claude.cmd` on PATH, which `spawn` without a shell cannot start; the native installer puts `claude.exe`. T6 must resolve the executable or fail with a clear message.
- **Other `result` subtypes**, for example `error_during_execution`. The mapping treats any `is_error: true` the same.

## Fixtures

In `fixtures/streams/`, sanitized with `fixtures/streams/sanitize.ts` (working folder becomes `/work/toy`, home and user name become `user`, plan utilization zeroed):

| File | Prompt | Shows |
| --- | --- | --- |
| `claude-code-success.jsonl` | create `hello.js` with file tools, edit it, run it | Write, Edit, a denied Bash, thinking, success |
| `claude-code-bash-write.jsonl` | create `hello.js` and run it | file written through Bash only |
| `claude-code-max-turns.jsonl` | create three files, `--max-turns 1` | denial, `error_max_turns`, exit 1 |
| `claude-code-cancelled.jsonl` | run `sleep 60`, SIGTERM after the tool call | no `result`, exit 143 |

To re-record: run the command above in a scratch git repo with the prompt on stdin, redirect stdout to a raw file, then `node fixtures/streams/sanitize.ts <raw> <fixture> <scratch repo path>`. The sanitizer refuses to write a file that still contains the user name.
