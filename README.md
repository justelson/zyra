# Zyra

Zyra is a local coding agent for the terminal and desktop. It works in your project directory, can inspect and edit files, runs checks, and keeps chats and project context local.

## Install the TUI

Release installs are self-contained. You do not need Node.js, Bun, npm, or Pi on the machine running Zyra.

### Windows

Windows 10 or 11, x64:

```powershell
irm https://raw.githubusercontent.com/justelson/zyra/master/install.ps1 | iex
```

Open a new PowerShell or Command Prompt window, then run `zyra`.

### macOS

Apple silicon and Intel Macs:

```bash
curl -fsSL https://raw.githubusercontent.com/justelson/zyra/master/install.sh | bash
```

The installer selects `macos-arm64` or `macos-x64` automatically and places the command in `~/.local/bin`.

### Linux

64-bit x86 Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/justelson/zyra/master/install.sh | bash
```

The installer places the command in `~/.local/bin`. Add that directory to `PATH` if the installer asks you to.

Every installer downloads one platform binary, verifies it against the release `SHA256SUMS`, and keeps versions side by side so an update does not partially replace a working install.

## Start

Run Zyra from the project you want it to work on:

```bash
cd path/to/your/project
zyra
```

On first run, connect either a ChatGPT/Codex subscription or an OpenAI API key:

```bash
zyra login subscription
zyra login api
```

API usage is billed separately by OpenAI. Credentials remain in Pi's local auth store at `~/.pi/agent/auth.json`; they are not copied into a project or release artifact.

Useful commands:

```bash
zyra                         # open a chat in the current project
zyra -p "explain this error" # one prompt, printed to the terminal
zyra resume                  # reopen a previous chat
zyra new --full-access       # start a chat without command or edit prompts
zyra new --auto-review       # let Zyra review commands and edits automatically
zyra new --edits-only        # allow edits but keep command approvals
zyra new --supervised        # start a chat that asks before risky tools
zyra threads                 # list local chats
zyra doctor                  # check the local setup
zyra --update                # install the latest release
```

Resumed chats keep their permission mode. An explicit startup flag overrides it for that chat; use `/access` to change it inside the TUI.

Type `/` in a chat to find commands and discovered Agent Skills. Project commands live in `.zyra/commands`; project skills can come from `.zyra/skills`, `.agents/skills`, or `.pi/skills`. See the [agents, skills, and workflows guide](docs/guides/subagents-workflows.md).

## Desktop

Native Windows, macOS, and Linux installers are published on the [GitHub Releases page](https://github.com/justelson/zyra/releases). Desktop and TUI use the same local chats and agent runtime.

## Build from source

Development requires Node.js 22.19 or newer and Bun 1.3.9.

```bash
git clone https://github.com/justelson/zyra.git
cd zyra
npm ci
npm run check:quick
npm run zyra
```

Build the standalone TUI for the current machine:

```bash
npm run release:tui
```

Explicit targets are `windows-x64`, `macos-arm64`, `macos-x64`, and `linux-x64`:

```bash
node scripts/build-tui-release.mjs --target=linux-x64
```

Desktop development:

```bash
npm --prefix desktop ci
npm run ui:dev
```

Use the focused validation commands in [fast-validation.md](docs/development/fast-validation.md). Contribution and privacy rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy and license

Chats, project memory, local profiles, and credentials stay local by default. Optional product analytics are disabled by default and exclude prompts, responses, files, paths, URLs, terminal content, account identity, and raw errors. See [product analytics](docs/architecture/product-analytics.md).

Copyright 2026 justelson. Zyra is licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md) for packaged dependencies and assets.
