# task-run: requirements

Run one task through an agent harness, stream what happens, and record the result in git with trailers so it can be traced back to requirements.

## R1: Normalized event model
priority: must
status: approved

All harnesses report progress through one event model defined in `core`, so nothing outside an adapter depends on a harness's format.

- Given any adapter
- When it runs a task
- Then it emits only events of these kinds: `started`, `message`, `tool-call`, `file-changed`, `command`, `usage`, `error`, `finished`
- And `usage` is optional: an adapter that cannot report it simply never emits it

## R2: Adapter interface
priority: must
status: approved

Adapters implement one small interface that can be registered by name.

- Given an adapter registered as `claude-code`
- When config selects `harness.default: claude-code`
- Then the runner uses it, and an unknown name fails with the list of registered adapters

## R3: Build the task prompt
priority: must
status: approved

The prompt sent to the harness contains everything the agent needs and nothing it does not.

- Given task `T2` referencing `R3`
- When the prompt is built
- Then it includes the steering files, the task text, the full text of each referenced requirement, the feature's `design.md`, and the instruction to work on this task only
- And it lists the IDs and titles of the feature's other tasks that are not `done`, marked out of scope
- And it tells the harness not to edit files under the specs folder, because specflow updates the task's status
- And it asks the harness to end its final reply with a `Spec notes:` section when it found problems in the spec or made decisions the spec does not cover
- And it does not include other features' specs

## R4: Claude Code adapter
priority: must
status: approved

Run Claude Code headless with streaming JSON output and translate its events into the normalized model.

- Given Claude Code is installed and authenticated
- When a task runs
- Then events stream to the caller as they arrive, and the run ends with exactly one `finished` event carrying success or failure
- Given Claude Code is not installed, then the run fails before starting with a message explaining how to install it

## R5: Cancel a run
priority: must
status: approved

- Given a task is running
- When the caller cancels
- Then the harness process is terminated within 5 seconds and a `finished` event with `cancelled: true` is emitted

## R6: Commit with trailers
priority: must
status: approved

After a successful run, changes are recorded with spec trailers.

- Given `commit.mode: staged`, then changed files are staged and a prepared commit message with trailers is returned, nothing is committed
- Given `commit.mode: auto`, then a commit is created with the trailers `Spec-Feature`, `Spec-Task`, `Spec-Req`
- And the commit body is the first paragraph of the run's final summary, without its spec notes
- Given a failed or cancelled run, then nothing is staged or committed

## R7: Update task status
priority: should
status: approved

- Given a run starts, then the task's `status` line becomes `doing`
- Given a successful run is recorded, then it becomes `done` and the `tasks.md` change is part of what is recorded: staged in `staged` mode, included in the commit in `auto` mode
- Given the run fails or is cancelled, then it returns to its previous status
- Given a staged result is discarded, then it returns to its previous status
- And no other line in `tasks.md` changes
- And specflow is the only writer of the status line: the harness is told not to edit it

## R8: Trace a requirement or task
priority: must
status: approved

Answer "what implements this?" from git history alone.

- Given commits with trailers referencing `task-run/R3`
- When `trace task-run/R3` runs
- Then it lists the tasks referencing R3 and every commit whose trailers reference R3, newest first, with hash, date, subject and files changed
- And it survives rebases, because it reads trailers, not hashes stored elsewhere

## R9: Replay adapter for tests
priority: must
status: approved

- Given a recorded event stream file
- When the replay adapter runs a task
- Then it emits the recorded events in order, so runner and UI can be tested without a live harness

## R10: Refuse to run on a dirty tree
priority: should
status: approved

- Given uncommitted changes in files outside `.specs/`
- When a run is requested
- Then it refuses with the list of dirty files, unless `--allow-dirty` is passed

## R11: Flag changes outside the task
priority: should
status: approved

Changes the task did not plan are flagged after the run, never silently recorded or reverted. Code written for another task would otherwise be traced to the wrong requirement.

- Given a task with a `files:` list of paths or globs
- When the run changes a file that matches none of them
- Then the result lists it as out of scope and `run` prints a warning naming it
- Given the harness changed a file under the specs folder
- Then the result lists it as a spec edit, it is left out of the recording so it stays unstaged for review, and `run` prints a warning naming it
- And the feature's `tasks.md` is still recorded with the status change
- And a task without `files:` gets no out-of-scope check

## R12: Surface the agent's spec notes
priority: should
status: approved

The harness can suggest spec changes; humans decide whether to make them.

- Given the run's final reply ends with a `Spec notes:` section
- When the run finishes
- Then `run` prints the notes separately after the result, and `--json` includes them as `specNotes`
- And the notes are not part of the commit message
