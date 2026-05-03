# Getting Started with Hammer

Hammer is an AI coding agent that handles planning, execution, verification, and shipping so you can focus on what to build. It is a fork of [GSD-2](https://github.com/gsd-build/GSD-2) with a deliberately different posture: **no permission prompts, no confirm-before-edit, no human checkpoints between phases**. The recover-and-resume loop (3-strike cap, `RECOVERY_VERDICT` parsing) is the only structural guardrail. This guide walks you through installation on macOS, Windows, and Linux, then gets you running your first session.

> **Audience.** Hammer is built for experienced operators who want autonomous execution and treat the file system, shell, and git as cheap to fork or revert. If you want a coding agent that pauses before edits, you want a different tool. See [No-Guardrails Posture](#no-guardrails-posture) below before installing.

> **Internal-implementation note.** The CLI binary is still `gsd`, the npm package is still `gsd-pi`, and project state still lives under `.gsd/` (with `.hammer/` for runtime artifacts). Filesystem paths, environment variables (`GSD_*`), and tool names (`gsd_*` / `hammer_*` aliases) are preserved verbatim from the GSD-2 fork point — only user-facing prose, slash commands (formerly `/gsd …`, now `/hammer …`), and the chat handle (formerly `@gsd`, now `@hammer`) are rebranded.

---

## Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **[Node.js](https://nodejs.org/)** | 22.0.0 | 24 LTS |
| **[Git](https://git-scm.com/)** | 2.20+ | Latest |
| **LLM API key** | Any supported provider | Anthropic (Claude) |

Don't have Node.js or Git yet? Follow the OS-specific instructions below.

---

## Install by Operating System

### macOS

> **Downloads:** [Node.js](https://nodejs.org/) | [Git](https://git-scm.com/download/mac) | [Homebrew](https://brew.sh/)

**Step 1 — Install Homebrew** (skip if you already have it):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Step 2 — Install Node.js and Git:**

```bash
brew install node git
```

**Step 3 — Verify dependencies are installed:**

```bash
node --version   # should print v22.x or higher
git --version    # should print 2.20+
```

**Step 4 — Install Hammer:**

```bash
npm install -g gsd-pi
```

**Step 5 — Set up your LLM provider:**

```bash
# Option A: Set an environment variable (Anthropic recommended)
export ANTHROPIC_API_KEY="sk-ant-..."

# Option B: Use the built-in config wizard
gsd config
```

To persist the key, add the export line to `~/.zshrc`:

```bash
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc
source ~/.zshrc
```

See [Provider Setup Guide](./providers.md) for all 20+ supported providers.

**Step 6 — Launch Hammer:**

```bash
cd ~/my-project   # navigate to any project
gsd               # start a session
```

**Step 7 — Verify everything works:**

```bash
gsd --version     # prints the installed version
```

Inside the session, type `/model` to confirm your LLM is connected.

> **Apple Silicon PATH fix:** If `gsd` isn't found after install, npm's global bin may not be in your PATH:
> ```bash
> echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.zshrc
> source ~/.zshrc
> ```

> **oh-my-zsh conflict:** The oh-my-zsh git plugin defines `alias gsd='git svn dcommit'`. Fix with `unalias gsd 2>/dev/null` in `~/.zshrc`, or use `gsd-cli` instead.

---

### Windows

> **Downloads:** [Node.js](https://nodejs.org/) | [Git for Windows](https://git-scm.com/download/win) | [Windows Terminal](https://aka.ms/terminal)

#### Option A: winget (recommended for Windows 10/11)

**Step 1 — Install Node.js and Git:**

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

**Step 2 — Restart your terminal** (close and reopen PowerShell or Windows Terminal).

**Step 3 — Verify dependencies are installed:**

```powershell
node --version   # should print v22.x or higher
git --version    # should print 2.20+
```

**Step 4 — Install Hammer:**

```powershell
npm install -g gsd-pi
```

**Step 5 — Set up your LLM provider:**

```powershell
# Option A: Set an environment variable (current session)
$env:ANTHROPIC_API_KEY = "sk-ant-..."

# Option B: Use the built-in config wizard
gsd config
```

To persist the key permanently, add it via System Settings > Environment Variables, or run:

```powershell
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")
```

See [Provider Setup Guide](./providers.md) for all 20+ supported providers.

**Step 6 — Launch Hammer:**

```powershell
cd C:\Users\you\my-project   # navigate to any project
gsd                           # start a session
```

**Step 7 — Verify everything works:**

```powershell
gsd --version     # prints the installed version
```

Inside the session, type `/model` to confirm your LLM is connected.

#### Option B: Manual install

1. Download and install [Node.js LTS](https://nodejs.org/) — check **"Add to PATH"** during setup
2. Download and install [Git for Windows](https://git-scm.com/download/win) — use default options
3. Open a **new** terminal, then follow Steps 3-7 above

> **Windows tips:**
> - Use **Windows Terminal** or **PowerShell** for the best experience. Command Prompt works but has limited color support.
> - If `gsd` isn't recognized, restart your terminal. Windows needs a fresh terminal to pick up new PATH entries.
> - **WSL2** also works — install WSL, then follow the Linux instructions inside your distro.

---

### Linux

> **Downloads:** [Node.js](https://nodejs.org/) | [Git](https://git-scm.com/download/linux) | [nvm](https://github.com/nvm-sh/nvm)

Pick your distro, then follow the steps.

#### Ubuntu / Debian

**Step 1 — Install Node.js and Git:**

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

#### Fedora / RHEL / CentOS

**Step 1 — Install Node.js and Git:**

```bash
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs git
```

#### Arch Linux

**Step 1 — Install Node.js and Git:**

```bash
sudo pacman -S nodejs npm git
```

#### Using nvm (any distro)

**Step 1 — Install nvm, then Node.js:**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc   # or ~/.zshrc
nvm install 24
nvm use 24
```

#### All distros: Steps 2-7

**Step 2 — Verify dependencies are installed:**

```bash
node --version   # should print v22.x or higher
git --version    # should print 2.20+
```

**Step 3 — Install Hammer:**

```bash
npm install -g gsd-pi
```

**Step 4 — Set up your LLM provider:**

```bash
# Option A: Set an environment variable (Anthropic recommended)
export ANTHROPIC_API_KEY="sk-ant-..."

# Option B: Use the built-in config wizard
gsd config
```

To persist the key, add the export line to `~/.bashrc` (or `~/.zshrc`):

```bash
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.bashrc
source ~/.bashrc
```

See [Provider Setup Guide](./providers.md) for all 20+ supported providers.

**Step 5 — Launch Hammer:**

```bash
cd ~/my-project   # navigate to any project
gsd               # start a session
```

**Step 6 — Verify everything works:**

```bash
gsd --version     # prints the installed version
```

Inside the session, type `/model` to confirm your LLM is connected.

> **Permission errors on `npm install -g`?** Don't use `sudo npm`. Fix npm's global directory instead:
> ```bash
> mkdir -p ~/.npm-global
> npm config set prefix '~/.npm-global'
> echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
> source ~/.bashrc
> npm install -g gsd-pi
> ```

---

### Docker (any OS)

> **Downloads:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)

Run Hammer in an isolated sandbox without installing Node.js on your host.

**Step 1 — Install Docker Desktop** (4.58+ required).

**Step 2 — Clone the Hammer fork repo:**

```bash
git clone https://github.com/gsd-build/gsd-2.git
cd gsd-2/docker
```

**Step 3 — Create and enter a sandbox:**

```bash
docker sandbox create --template . --name gsd-sandbox
docker sandbox exec -it gsd-sandbox bash
```

**Step 4 — Set your API key and run Hammer:**

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
gsd auto "implement the feature described in issue #42"
```

See [Docker Sandbox docs](../../docker/README.md) for full configuration, resource limits, and compose files.

---

## After Installation

### Choose a Model

Hammer auto-selects a default model after provider setup. Switch anytime inside a session:

```
/model
```

Or configure per-phase models in preferences — see [Configuration](./configuration.md).

---

## Two Ways to Work

### Step Mode — `/hammer`

Type `/hammer` inside a session. Hammer executes one unit of work at a time, pausing between each with a wizard showing what completed and what's next.

- **No `.gsd/` directory** — starts a discussion flow to capture your project vision
- **Milestone exists, no roadmap** — discuss or research the milestone
- **Roadmap exists, slices pending** — plan the next slice or execute a task
- **Mid-task** — resume where you left off

Step mode keeps you in the loop, reviewing output between each step.

### Auto Mode — `/hammer auto`

Type `/hammer auto` and walk away. Hammer autonomously researches, plans, executes, verifies, commits, and advances through every slice until the milestone is complete.

```
/hammer auto
```

See [Auto Mode](./auto-mode.md) for full details.

---

## No-Guardrails Posture

Hammer is intentionally an **unsafe-mode-by-default** tool for experienced operators. Read this section before running `/hammer auto` against a tree you care about.

**What "no-guardrails" means in practice:**

- **No confirm-before-edit.** File writes happen without a permission prompt.
- **No shell-command approval gate.** `bash`, `async_bash`, and `bg_shell` invocations execute directly.
- **No per-phase human checkpoint.** Auto-mode advances from research → plan → execute → complete → reassess without pausing for review unless you explicitly enable `require_slice_discussion: true` in preferences.
- **No "are you sure?" before destructive operations.** `git reset`, `rm -rf`, and dependency installs run when the agent decides to run them.

**Why this is a deliberate product distinction.** Hammer is a fork of [GSD-2](https://github.com/gsd-build/GSD-2) with the permission-prompt surface deliberately removed. Operators should treat the file system, shell, and git as cheap to fork or revert — that is the cost of being able to walk away during long autonomous milestones. If you want a coding agent that pauses before edits, you want a different tool; "re-introducing permission prompts" is a non-goal for Hammer.

**The only structural guardrail.** The recover-and-resume loop has a **3-strike cap**: if recovery itself fails three times in a row (parsed via the `RECOVERY_VERDICT` trailer and counted in `consecutiveRecoveryFailures` inside `.hammer/auto-MID.lock`), auto-mode pauses and surfaces the structured verdict for human inspection rather than spinning forever. There is no other built-in checkpoint between the operator and a sequence of agent edits.

**IAM fail-closed contract.** Subagent dispatches return through an `IAM_SUBAGENT_CONTRACT` envelope with a marker chokepoint at `iam-subagent-policy.ts`. If a sub-step terminates with malformed or missing markers, the loop refuses to advance — silent advance is structurally impossible. See [Troubleshooting → IAM integration](./troubleshooting.md#iam-integration) for the structured remediation shape.

**Recommended operator setup before running auto-mode:**

1. **Use git isolation.** Hammer defaults to `git.isolation: worktree` so auto-mode commits land in `.gsd/worktrees/<MID>/` on a `milestone/<MID>` branch, not directly on your working branch. Keep this default unless you understand the trade-off.
2. **Set a `budget_ceiling`.** Cap aggregate USD spend before walking away from a session.
3. **Run in a sandbox if you do not trust the input.** The Docker sandbox at `docker/` runs Hammer as the `gsd-sandbox` container with limited host filesystem reach.
4. **Watch the activity stream.** `Ctrl+Alt+G` or `/hammer status` shows the current unit, the recovery cap state, and the IAM verdict trailer of the most recent subagent return.

If any of those four properties are not acceptable to you for the project at hand, do not enable auto-mode on this project.

---

## Recommended Workflow: Two Terminals

Run auto mode in one terminal, steer from another.

**Terminal 1 — let it build:**

```bash
gsd
/hammer auto
```

**Terminal 2 — steer while it works:**

```bash
gsd
/hammer discuss    # talk through architecture decisions
/hammer status     # check progress
/hammer queue      # queue the next milestone
```

Both terminals read and write the same `.gsd/` files. Decisions in terminal 2 are picked up at the next phase boundary automatically.

---

## How Hammer Organizes Work

```
Milestone  →  a shippable version (4-10 slices)
  Slice    →  one demoable vertical capability (1-7 tasks)
    Task   →  one context-window-sized unit of work
```

The iron rule: **a task must fit in one context window.** If it can't, it's two tasks.

All state lives on disk in `.gsd/`:

```
.gsd/
  PROJECT.md          — what the project is right now
  REQUIREMENTS.md     — requirement contract
  DECISIONS.md        — append-only architectural decisions
  KNOWLEDGE.md        — cross-session rules and patterns
  STATE.md            — quick-glance status
  milestones/
    M001/
      M001-ROADMAP.md — slice plan with dependencies
      slices/
        S01/
          S01-PLAN.md     — task decomposition
          S01-SUMMARY.md  — what happened
```

---

## VS Code Extension

Hammer is also available as a VS Code extension. Install from the marketplace (publisher: FluxLabs) or search for "Hammer" in VS Code extensions:

- **`@hammer` chat participant** — talk to the agent in VS Code Chat
- **Sidebar dashboard** — connection status, model info, token usage, IAM verdicts, recover-and-resume cap state
- **Full command palette** — start/stop agent, switch models, export sessions

The CLI (`gsd-pi`) must be installed first — the extension connects to it via RPC. The npm package, binary name, and VS Code setting prefix (`gsd.*`) remain on the GSD identifier verbatim per the rebrand-window scoping rule.

---

## Web Interface

Hammer has a browser-based interface for visual project management:

```bash
gsd --web
```

See [Web Interface](./web-interface.md) for details.

---

## Resume a Session

```bash
gsd --continue    # or gsd -c
```

Resumes the most recent session for the current directory.

Browse all saved sessions:

```bash
gsd sessions
```

---

## Updating Hammer

Hammer checks for updates every 24 hours and prompts at startup. You can also update manually:

```bash
npm update -g gsd-pi
```

Or from within a session:

```
/hammer update
```

---

## Quick Troubleshooting

| Problem | Fix |
|---------|-----|
| `command not found: gsd` | Add npm global bin to PATH (see OS-specific notes above) |
| `gsd` runs `git svn dcommit` | oh-my-zsh conflict — `unalias gsd` or use `gsd-cli` |
| Permission errors on `npm install -g` | Fix npm prefix (see Linux notes) or use nvm |
| Can't connect to LLM | Check API key with `gsd config`, verify network access |
| `gsd` hangs on start | Check Node.js version: `node --version` (need 22+) |

For more, see [Troubleshooting](./troubleshooting.md).

---

## Next Steps

- [Auto Mode](./auto-mode.md) — deep dive into autonomous execution
- [Configuration](./configuration.md) — model selection, timeouts, budgets
- [Commands Reference](./commands.md) — all commands and shortcuts
- [Provider Setup](./providers.md) — detailed setup for every provider
- [Working in Teams](./working-in-teams.md) — multi-developer workflows
