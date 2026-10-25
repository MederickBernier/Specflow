# workbench-ui: requirements

One Specflow workbench inside VS Code: see where every feature stands, run tasks from a board, review a run's diff inline, follow a requirement to its commits, and work through drift findings. It complements the native views (Specs explorer, Problems panel, Run review); it does not replace them.

## R1: Open the workbench
priority: must
status: approved

- Given a workspace with specs
- When the user runs `Specflow: Open workbench`, or clicks the workbench button in the Specs view title
- Then one editor tab opens with the tabs Overview, Board, Review, Trace and Drift, and running the command again reveals the same tab
- And it uses the editor's theme colors and fonts, loads nothing from the network, and every action is reachable by keyboard
- When a spec file, the run state or the drift results change, then the open workbench shows the change within 1 second
- When the tab is hidden and shown again, or VS Code reloads with it open, then it comes back on the same tab

## R2: Overview
priority: must
status: approved

- Given a loaded spec tree
- Then the Overview shows each feature with its requirements and tasks counted by status, and its share of tasks done
- And it shows the number of lint problems, the number of drift findings (or "not checked"), and the harness health
- When a root fails to load, then the Overview shows the load error instead of stale data
- When the user clicks a feature, then the Board opens filtered to that feature

## R3: Task board
priority: must
status: approved

- Given a loaded spec tree
- Then the Board shows one column per task status (todo, doing, done, blocked), with a card per task showing its ID, title, feature, requirements and dependencies
- And a task whose dependencies are not all done is marked as waiting, naming them
- When the user presses Run on a card, then the run starts through the same flow as `Specflow: Run task`, including the confirmation
- When the user opens a card, then the editor opens the task's heading
- And the Board can be filtered by feature

## R4: Inline diff review
priority: must
status: approved

- Given a staged run under review
- Then the Review tab lists the run's changed files with added and removed line counts, marking files outside the task's `files:` list
- And each file's diff against `HEAD` renders inline with line numbers, as unified or side by side (the choice is remembered)
- And the tab shows the run's spec notes, Accept and commit, Discard changes, and per file Open in VS Code diff
- When a reviewed file is edited before accepting, then its diff updates
- Given a binary file, or one too large to render, then a placeholder with Open in VS Code diff is shown instead of its diff
- Given no run under review, then the tab shows the working tree's uncommitted changes against `HEAD`, read only, including untracked files

## R5: Trace
priority: must
status: approved

- Given a requirement or task picked in the Trace tab, from a requirement's CodeLens, or from the Specs view
- Then the tab shows its tasks with status and the commits that implement them, newest first, with hash, date, subject and files
- When the user picks a commit, then its diff renders inline with the same viewer as Review

## R6: Drift report
priority: must
status: approved

- Given drift results
- Then the Drift tab lists the findings grouped by feature and requirement, with rule, message, file and commit
- And it has a Check drift button that runs the same pass as `Specflow: Check drift`, showing progress while it runs
- When the user picks a finding's commit, then its diff renders inline
- When the user acknowledges a finding and confirms, then `drift-ack: <commit>` is written on the requirement and the finding disappears on the next check
- Given drift was never checked in this session, then the tab says so instead of showing an empty list

## R7: Acknowledge drift from the CLI
priority: should
status: approved

- Given a requirement and a commit
- When the user runs `specflow drift ack <feature>/<R id> <commit>`
- Then the requirement's `drift-ack:` line is set to that commit, inserted after its heading if missing, changing no other line
- Given an unknown requirement or a commit git cannot resolve, then nothing is written and the command exits with an error
