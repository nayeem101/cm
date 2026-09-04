# cm — CLI command stash

Store CLI commands with what they do, fuzzy-search them later, hit `Enter` to copy, then `Ctrl+V` to paste. Like Linux `history`, but curated and searchable.

Built with [Bun](https://bun.sh) + `bun:sqlite`. Windows-only, tested in **Git Bash** (default in Windows Terminal), PowerShell, and CMD. Zero runtime dependencies.

## Install (global `cm` command)

```bash
git clone <your-repo-url> cm
cd cm
bun install
bun run build
mkdir -p ~/bin
cp cm.exe ~/bin/cm.exe
```

`~/bin` (`%USERPROFILE%\bin`) is auto-included in Git Bash PATH. For PowerShell/CMD, add it once to Windows User PATH:

```powershell
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ";$env:USERPROFILE\bin", 'User')
```

Restart Windows Terminal, then:

```bash
cm --help
```

After any code change, rebuild + re-copy:

```bash
bun run build && cp cm.exe ~/bin/cm.exe
```

Dev mode without installing (runs from source):

```bash
bun src/index.ts <args>
```

## Usage

```bash
cm                                   # interactive search (default)
cm search [query]                    # search with initial filter
cm add "<command>" -d "<what it does>" [-t tag1,tag2] [--cwd <path>|auto] [-g]
cm list [--json]                     # list all entries
cm rm <id|exact-command>              # delete entry (a non-exact query only lists matches)
cm edit <id> [--command ...] [--desc ...] [--tags ...] [--cwd ...]
```

Examples:

```bash
cm add "docker ps -a" -d "list all containers" -t docker,ps
cm add "git log --oneline -10" -d "recent commits" -t git
cm list
cm search docker
```

Adding the same command twice updates its description/tags instead of duplicating.

## Search keys

| Key | Action |
|---|---|
| type | fuzzy-filter on command + description + tags |
| `↑` / `↓` | navigate |
| `Enter` | copy to clipboard, bump usage, quit |
| `Esc` / `Ctrl+C` / `Ctrl+X` | quit without copying |
| `Ctrl+U` | clear query |
| `Ctrl+W` | delete last word |
| `Backspace` | delete char |

After `Enter`, paste with `Ctrl+V`.

Ranking: current-folder (`cwd`) matches first, then usage count + recency.

## Where data lives

`~/.cm/cm.db` (SQLite), resolved via `os.homedir()` so PowerShell and Git Bash share the same file.

Schema per entry: `id, command (unique), description, tags, cwd, use_count, last_used, created_at`.

## Git Bash notes

- TUI uses pure ANSI + raw stdin (no Windows Console API), so it works in both Windows Terminal + Git Bash and standalone mintty.
- Clipboard uses `powershell.exe Set-Clipboard` with `clip.exe` fallback — no extra packages, Unicode-safe.
- If arrows misbehave in mintty, use Windows Terminal (recommended).

## Scripts

| Script | What it does |
|---|---|
| `bun src/index.ts` / `bun run start` | run from source |
| `bun run build` | compile to `cm.exe` |
| `bun test` | e2e smoke tests (temp DB via `CM_DB_PATH`, real DB untouched) |
| `bun run typecheck` | `tsc --noEmit` |
