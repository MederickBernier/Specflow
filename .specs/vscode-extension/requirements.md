# vscode-extension: requirements

A thin VS Code shell over `core`: browse specs, run tasks, review diffs, see drift, without leaving the editor. Reuses VS Code's own diff editor and git integration.

## R1: Activate only where relevant
priority: must
status: approved

- Given a workspace containing `.specs/config.yml` or a `.specs/` folder
- Then the extension activates
- Given a workspace without it, then only the `Initialize specs` command is available

## R2: Spec explorer
priority: must
status: approved

A tree view lists features, then requirements and tasks, with status icons.

- Given a loaded spec tree
- Then the view shows each feature with its requirements and tasks, and tasks show their status as an icon
- When a node is clicked, then the editor opens the file at that item's line
- When any file under `.specs/` is saved, then the view refreshes within 1 second

## R3: Lint diagnostics
priority: must
status: approved

- Given lint findings
- Then they appear in the Problems panel on the right file and line, with the rule ID as the code
- When the finding is fixed and the file saved, then it disappears

## R4: Run a task
priority: must
status: approved

- Given a task in the explorer or a CodeLens above a task heading
- When the user runs it
- Then a confirmation shows the task, harness and commit mode (skippable via a setting)
- And events stream into an output view: messages, tool calls, files changed, usage
- And the run can be cancelled from that view

## R5: Review the result
priority: must
status: approved

- Given a successful run
- Then a list of changed files is shown, each opening VS Code's built-in diff editor against `HEAD`
- And the user can accept (commit with the prepared trailers) or discard (restore the files)

## R6: Drift diagnostics
priority: must
status: approved

- When the user runs `Check drift`, or on save of a spec file if enabled in settings
- Then drift findings appear in the Problems panel on the requirement's heading, with the file and commit in the message

## R7: Requirement CodeLens
priority: should
status: approved

- Given a requirement heading in an open `requirements.md`
- Then a CodeLens above it shows the number of tasks, the last commit date, and the number of drift findings
- When clicked, then the trace for that requirement opens in a quick pick

## R8: Harness health
priority: must
status: approved

- Given the configured harness is missing or not authenticated
- When the extension activates or a run is requested
- Then a clear message explains what is wrong, with a button linking to the harness's install docs

## R9: Commands parity with the CLI
priority: should
status: approved

- Given any CLI command (`init`, `lint`, `run`, `trace`, `drift`)
- Then an equivalent command exists in the command palette

## R10: Published and installable
priority: must
status: approved

- Given the release build
- Then it is published to the VS Code Marketplace and Open VSX
- And a new user can install it and run a task by following the README alone
