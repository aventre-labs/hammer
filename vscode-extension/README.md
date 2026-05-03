# Hammer — VS Code Extension

Control the Hammer coding agent directly from VS Code. Run autonomous coding sessions, chat with `@hammer`, monitor agent activity in real-time, review and accept/reject changes, and manage your workflow — all without leaving the editor.

> Hammer is forked from GSD-2. The npm package (`gsd-pi`), binary name (`gsd`), VS Code setting prefix (`gsd.*`), and `@gsd` chat handle aliasing are preserved as internal-implementation surface during the rebrand window. The product identity in user-facing prose is Hammer.

### IAM and recover-and-resume

Hammer ships an **IAM (Identity & Awareness Mesh)** envelope that fails closed when policy or recovery decisions would otherwise drift silently — agent and subagent tool calls are checked against the IAM policy at runtime. Auto-mode also runs a **recover-and-resume** loop with a 3-strike cap: if recovery itself fails three times in a row, the loop pauses and surfaces a structured `RECOVERY_VERDICT` trailer for inspection in the activity feed rather than spinning forever.

![Hammer Extension Overview](docs/images/overview.png)

## Requirements

- **Hammer** installed globally: `npm install -g gsd-pi`
- **Node.js** >= 22.0.0
- **Git** installed and on PATH
- **VS Code** >= 1.95.0

## Quick Start

1. Install Hammer: `npm install -g gsd-pi`
2. Install this extension
3. Open a project folder in VS Code
4. Click the **Hammer icon** in the Activity Bar (left sidebar)
5. Click **Start Agent** or run `Ctrl+Shift+P` > **Hammer: Start Agent**
6. Start chatting with `@hammer` in Chat or click **Auto** in the sidebar

---

## Features

### Sidebar Dashboard

Click the **Hammer icon** in the Activity Bar. The compact header shows connection status, model, session, message count, thinking level, context usage bar, and cost — all in two lines. Sections (Workflow, Stats, Actions, Settings) are collapsible and remember their state.

### Workflow Controls

One-click buttons for Hammer's core commands. All route through the Chat panel so you see the full response:

| Button | What it does |
|--------|-------------|
| **Auto** | Start autonomous mode — research, plan, execute |
| **Next** | Execute one unit of work, then pause |
| **Quick** | Quick task without planning (opens input) |
| **Capture** | Capture a thought for later triage |

### Chat Integration (`@hammer`)

Use `@hammer` in VS Code Chat (`Cmd+Shift+I`) to talk to the agent:

```
@hammer refactor the auth module to use JWT
@hammer /hammer auto
@hammer fix the errors in this file
```

- **Auto-starts** the agent if not running
- **File context** via `#file` references
- **Selection context** — automatically includes selected code
- **Diagnostic context** — auto-includes errors/warnings when you mention "fix" or "error"
- **Streaming** progress, file anchors, token usage footer

### Source Control Integration

Agent-modified files appear in a dedicated **"Hammer Agent"** section of the Source Control panel:

- **Click any file** to see a before/after diff in VS Code's native diff editor
- **Accept** or **Discard** changes per-file via inline buttons
- **Accept All** / **Discard All** via the SCM title bar
- Gutter diff indicators (green/red bars) show exactly what changed

### Line-Level Decorations

When the agent modifies a file, you'll see:
- **Green background** on newly added lines
- **Yellow background** on modified lines
- **Left border gutter indicator** on all agent-touched lines
- **Hover** any decorated line to see "Modified by Hammer Agent"

### Checkpoints & Rollback

Automatic checkpoints are created at the start of each agent turn. Use **Discard All** in the SCM panel to revert all agent changes to their original state, or discard individual files.

### Activity Feed

The **Activity** panel shows a real-time log of every tool the agent executes — Read, Write, Edit, Bash, Grep, Glob — with status icons (running/success/error), duration, and click-to-open for file operations. When the recover-and-resume loop trips its 3-strike cap, the structured `RECOVERY_VERDICT` trailer is surfaced here.

### Sessions

The **Sessions** panel lists all past sessions for the current workspace. Click any session to switch to it. The current session is highlighted green. Sessions persist to disk automatically.

### Diagnostic Integration

- **Fix Errors** button in the sidebar reads the active file's diagnostics from the Problems panel and sends them to the agent
- **Fix All Problems** (`Cmd+Shift+P` > Hammer: Fix All Problems) collects errors/warnings across the workspace
- Works automatically in chat — mention "fix" or "error" and diagnostics are included

### Code Lens

Four inline actions above every function and class (TS/JS/Python/Go/Rust):

| Action | What it does |
|--------|-------------|
| **Ask Hammer** | Explain the function/class |
| **Refactor** | Improve clarity, performance, or structure |
| **Find Bugs** | Review for bugs and edge cases |
| **Tests** | Generate test coverage |

### Git Integration

- **Commit Agent Changes** — stages and commits modified files with your message
- **Create Branch** — create a new branch for agent work
- **Show Diff** — view git diff of agent changes

### Approval Modes

Hammer's default disposition is **go**, not **ask** — auto-approve runs with no permission prompts. Other modes are opt-in:

| Mode | Behavior |
|------|----------|
| **Auto-approve** | Agent runs freely (default — Hammer's no-guardrails posture) |
| **Ask** | Prompts before file writes and commands |
| **Plan-only** | Read-only — agent can analyze but not modify |

Change via Settings section or `Cmd+Shift+P` > **Hammer: Select Approval Mode**.

### Agent UI Requests

When the agent needs input (questions, confirmations, selections), VS Code dialogs appear automatically — no more hanging on `ask_user_questions`.

### Additional Features

- **Conversation History** — full message viewer with tool calls, thinking blocks, search, and fork-from-here
- **Slash Command Completion** — type `/` for auto-complete of `/hammer` commands
- **File Decorations** — "H" badge on agent-modified files in the Explorer
- **Bash Terminal** — dedicated terminal for agent shell output
- **Context Window Warning** — notification when context exceeds threshold
- **Progress Notifications** — optional notification with cancel button (off by default)

---

## All Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Hammer: Start Agent** | | Connect to the Hammer agent |
| **Hammer: Stop Agent** | | Disconnect the agent |
| **Hammer: New Session** | `Cmd+Shift+G` `Cmd+Shift+N` | Start a fresh conversation |
| **Hammer: Send Message** | `Cmd+Shift+G` `Cmd+Shift+P` | Send a message to the agent |
| **Hammer: Abort** | `Cmd+Shift+G` `Cmd+Shift+A` | Interrupt the current operation |
| **Hammer: Steer Agent** | `Cmd+Shift+G` `Cmd+Shift+I` | Steering message mid-operation |
| **Hammer: Switch Model** | | Pick a model from QuickPick |
| **Hammer: Cycle Model** | `Cmd+Shift+G` `Cmd+Shift+M` | Rotate to the next model |
| **Hammer: Set Thinking Level** | | Choose off / low / medium / high |
| **Hammer: Cycle Thinking** | `Cmd+Shift+G` `Cmd+Shift+T` | Rotate through thinking levels |
| **Hammer: Compact Context** | | Trigger context compaction |
| **Hammer: Export HTML** | | Save session as HTML |
| **Hammer: Session Stats** | | Display token usage and cost |
| **Hammer: Run Bash** | | Execute a shell command |
| **Hammer: List Commands** | | Browse slash commands |
| **Hammer: Set Session Name** | | Rename current session |
| **Hammer: Copy Last Response** | | Copy to clipboard |
| **Hammer: Switch Session** | | Load a different session |
| **Hammer: Show History** | | Open conversation viewer |
| **Hammer: Fork Session** | | Fork from a previous message |
| **Hammer: Fix Problems in File** | | Send file diagnostics to agent |
| **Hammer: Fix All Problems** | | Send workspace errors to agent |
| **Hammer: Commit Agent Changes** | | Git commit modified files |
| **Hammer: Create Branch** | | Create branch for agent work |
| **Hammer: Show Agent Diff** | | View git diff |
| **Hammer: Accept All Changes** | | Accept all SCM changes |
| **Hammer: Discard All Changes** | | Revert all agent modifications |
| **Hammer: Select Approval Mode** | | Choose auto-approve/ask/plan-only |
| **Hammer: Cycle Approval Mode** | | Rotate through approval modes |
| **Hammer: Code Lens** actions | | Ask, Refactor, Find Bugs, Tests |

> On Windows/Linux, replace `Cmd` with `Ctrl`.

## Configuration

> Setting keys are kept under the `gsd.*` namespace as internal-implementation surface during the rebrand window.

| Setting | Default | Description |
|---------|---------|-------------|
| `gsd.binaryPath` | `"gsd"` | Path to the Hammer binary |
| `gsd.autoStart` | `false` | Start agent on extension activation |
| `gsd.autoCompaction` | `true` | Automatic context compaction |
| `gsd.codeLens` | `true` | Code lens above functions/classes |
| `gsd.showProgressNotifications` | `false` | Progress notification (off — Chat shows progress) |
| `gsd.activityFeedMaxItems` | `100` | Max items in Activity feed |
| `gsd.showContextWarning` | `true` | Warn when context exceeds threshold |
| `gsd.contextWarningThreshold` | `80` | Context % that triggers warning |
| `gsd.approvalMode` | `"auto-approve"` | Agent permission mode |

## How It Works

The extension spawns `gsd --mode rpc` and communicates over JSON-RPC via stdin/stdout. Agent events stream in real-time. The change tracker captures file state before modifications for SCM diffs and rollback. UI requests from the agent (questions, confirmations) are handled via VS Code dialogs. The IAM envelope and recover-and-resume loop run inside the agent process; their structured outputs surface in the Activity panel.

## Links

- [Hammer Documentation](https://github.com/gsd-build/gsd-2/tree/main/docs)
- [Getting Started](https://github.com/gsd-build/gsd-2/blob/main/docs/getting-started.md)
- [Issue Tracker](https://github.com/gsd-build/gsd-2/issues)
