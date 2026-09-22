# AnotherSkillHub

**A self-hosted, web-based skill hub for AI agents.** Any agent on any machine can pull, push, and share skills through one place — browse in a three-pane web UI, or use the one-line `ash` CLI.

> 网页端技能管理中心 + 终端 CLI：任意机器上的 AI Agent（Hermes / Claude Code / Codex / 任何能跑 bash 的 Agent）都能读写同一套技能库。

---

## Why

Agents multiply: you have one on your laptop, one on a rack server, one on a GPU box. Each accumulates its own skills — prompts, runbooks, scripts — and none of them can share. AnotherSkillHub gives them a shared home:

- **Agents read skills** — one command installs a full skill package (SKILL.md + scripts + references)
- **Agents write skills** — finished a task and distilled a skill? Push it to the hub in one command
- **You curate** — browse in a Gmail-style three-pane UI: folder tree, skill list, detail with outline, syntax highlighting, and line numbers

## Features

**Web UI**
- Three-pane layout: folder tree (collapsible) / skill list / detail view
- Skills land in an **Inbox** by default; file them into nested folders via drag & drop or move menu
- Markdown rendering with floating outline (scroll-synced), syntax highlighting for 30+ languages, line numbers for code files
- Multi-file skills: directory tree viewer for `scripts/`, `references/`, and any nested layout
- ⌘K command palette, batch operations, toast + undo, starred skills, tag filter, full-text search

**Agent CLI** (installed via one command)
- `ash pull <slug>` — install a complete skill package into the local agent's skills dir
- `ash push <dir>` — push a local skill to the hub's inbox
- `ash list` / `ash search <kw>` — find skills from the terminal
- Install script auto-detects Hermes / `~/.agents/skills` / Claude-style layouts

**Protocol-friendly URLs**
- `/s/<slug>.md` — clean Markdown for agents to fetch (content negotiation)
- `/s/<slug>/install.sh` — pipe-to-bash installer
- `/s/<slug>/archive.tar.gz` — full package archive

## Quick Start

```bash
# Clone and run (Node 22+, no external database needed — SQLite)
git clone https://github.com/Arismemo/AnotherSkillHub.git
cd AnotherSkillHub
npm install
npm --prefix client install
npm run build
npm start          # http://localhost:9444
```

Data lives in `server/data/` (SQLite + skill files on disk). Back up that directory and you've backed up everything.

### Docker

```bash
docker compose up -d --build   # binds 127.0.0.1:9444
```

### Agent setup (on any machine)

```bash
curl -fsSL https://your-hub.example.com/setup.sh | bash
```

Then, in any agent session:

```
ash pull <skill-name>
```

## How skills are stored

Each skill is a directory:

```
skills/
└── my-skill/
    ├── SKILL.md          # required: YAML frontmatter + Markdown body
    ├── scripts/          # optional: executable helpers
    └── references/       # optional: docs the skill links to
```

`SKILL.md` frontmatter:

```yaml
---
name: my-skill
description: One line describing when to use this skill
tags: [ops, debugging]
version: 1.0.0
---
```

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `PORT` | `9444` | HTTP port |
| `DATA_DIR` | `./server/data` | SQLite location |
| `STORAGE_DIR` | `./server/data/skills_files` | Skill files on disk |

## Security notes

This project ships **without authentication** by default — it is designed for personal or trusted-team use behind a reverse proxy / VPN. Put it behind your own auth layer (nginx basic auth, Cloudflare Access, Tailscale) before exposing it publicly.

## Contributing

PRs welcome. Keep changes minimal-diff; UI work should preserve existing keyboard behaviors and pass `npm run test:ui`.

## License

MIT
