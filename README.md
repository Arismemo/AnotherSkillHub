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
- `ash search <kw>` / `ash list` (`--tag`, `--folder`) / `ash info <slug>` / `ash show <slug>` / `ash versions <slug>` — compact text output built for agents (`--json` for raw)
- `ash pull <slug>` — install a complete skill package plus its `depends_on` skills into the local agent's skills dir
- `ash installed` / `ash outdated` / `ash pull --all` / `ash remove` — manage what's installed locally; locally modified skills are never overwritten silently (backed up to `~/.ash/backups`)
- `ash bundles` / `ash bundle <slug or name>` / `ash pull bundle:<slug or name>` — discover and install skill bundles
- `ash mine` / `ash withdraw <slug>` — follow the review status of your own pushes, retract pending ones
- `ash push <dir> [--update]` — push a local skill; overwriting an existing slug requires `--update`
- `ash guide` — the agent usage guide served by the hub (`/agent.md`); onboarding prompts just point here
- Install target auto-detection: `$ASH_SKILLS_DIR` → single `~/.hermes/profiles/*/skills` → `~/.hermes/skills` → `~/.agents/skills` → `~/.claude/skills` → `~/.dsh/skills`

**Human review of agent pushes**
- New skills and updates pushed by agents land in **待审核 (Pending)**; other agents can't pull them until approved
- Review updates as a line diff (plus attached-file changes) and approve/reject in the detail view; the pusher can use `--pending` meanwhile
- Pushes are security-scanned; findings are stored and shown on the skill, and high-risk hits always require review

**Protocol-friendly URLs**
- `/s/<slug>.md` — clean Markdown for agents (default for every non-browser client; multi-file skills get a file manifest appended, `?raw=1` for the original)
- `/s/<slug>/files/<path>` — a single attached file; `/s/<slug>/info` — plain-text summary
- `/agent.md` — agent usage guide
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

Open `http://localhost:9444`, register an account (the first account on a fresh instance becomes admin), and you land in your own private library at `/app`. Each account has its own skills, folders, bundles and review queue.

Data lives in `data/` (SQLite + skill files on disk). Back up that directory and you've backed up everything.

### Docker

```bash
docker compose up -d --build   # binds 127.0.0.1:9444
```

### Agent setup (on any machine)

```bash
curl -fsSL https://your-hub.example.com/setup.sh | bash
ash login          # username + password, exchanged for a personal API token in ~/.ash/token
```

Machines where you can't type a password: create a token under **Account** in the web UI and run `ash login --token <token>` (or export `ASH_TOKEN`). Then, in any agent session:

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

## Deployment

Self-host with Docker — full runbook (build gate, DB backup, image roll-out, rollback, smoke tests) in [docs/deploy.md](docs/deploy.md).

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `PORT` | `9444` | HTTP port |
| `DATA_DIR` | `./data` | SQLite location |
| `STORAGE_DIR` | `./data/skills_files` | Skill files on disk |
| `ASH_REQUIRE_REVIEW` | `1` | `0` publishes agent pushes directly (high-risk security hits are still held for review) |
| `ASH_REGISTRATION` | `open` | `closed` disables self-service sign-up (create accounts with `npm run user:create`) |
| `ASH_TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Express `trust proxy` — which hops may set `X-Forwarded-*` (client IP for login rate limiting, `https` for `Secure` cookies) |
| `ASH_SEED` | `1` | `0` skips the example skills given to each new account |
| `ASH_ALLOWED_EXTS` | text types | Comma-separated extension whitelist for attached files |

Client-side (`ash`): `ASH_SERVER_URL` overrides the hub address, `ASH_TOKEN` overrides the token saved by `ash login`, `ASH_SKILLS_DIR` sets the default install directory, `ASH_TERMINAL` names this machine in pushes (default: hostname; used by `ash mine` / `ash withdraw`), `ASH_BIN_DIR` sets where `ash` itself is installed (otherwise a writable bin dir, passwordless `sudo -n`, or `~/.local/bin` — it never blocks on a password prompt). The npm wrapper needs `ash config <url>` once.

## CLI & API examples

`ash` (CLI):

```bash
ash login                                  # 登录（或 ash login --token <token>）；ash whoami / ash logout
ash search 部署 仿真                        # 多个关键词需同时命中；纯文本输出
ash info systematic-debugging              # 描述、文件清单、安装命令
ash show systematic-debugging              # 直接输出 SKILL.md，不安装
ash pull systematic-debugging              # 安装技能（自动探测目录）
ash pull systematic-debugging --agent claude   # 指定安装到 ~/.claude/skills
ash pull systematic-debugging --dir ~/my-skills # 自定义安装目录
ash pull my-new-skill --pending            # 安装自己刚推送、尚在审核中的技能
ash pull systematic-debugging --no-deps    # 不安装 depends_on 依赖
ash installed                              # 本机已装技能：最新 / 有更新 / 本地有修改 / 远端已删除
ash pull --all                             # 更新全部过期技能（本地改过的跳过）
ash remove systematic-debugging            # 卸载（本地改过的先备份到 ~/.ash/backups）
ash bundles                                # 列出技能组合
ash pull bundle:感知工具箱                 # 按标识或名称安装整个组合
ash mine                                   # 我推送的技能及审核结果
ash withdraw my-new-skill                  # 撤回尚在待审核的推送
ash push ./my-skill/                       # 推送整个技能目录（含 references/scripts），进入待审核
ash push ./my-skill/ --update              # 更新已有技能（不加 --update 时同名会被拒绝）
ash guide                                  # Agent 使用指南
ash update                                 # 自更新 CLI
```

curl (REST) — every endpoint except `/api/auth/*`, `/setup.sh`, `/cli.sh` and `/agent.md` needs a token:

```bash
AUTH="Authorization: Bearer $ASH_TOKEN"
# 搜索
curl -s -H "$AUTH" 'https://your-host/api/skills?search=browser'
# 拉取 markdown
curl -s -H "$AUTH" https://your-host/s/systematic-debugging.md
# 推送归档（含附属文件）
tar -czf pkg.tgz -C ./my-skill . && curl -X POST -H "$AUTH" https://your-host/api/agent/push -F "file=@pkg.tgz" -F format=text   # 更新已有技能加 -F update=1
# 历史版本
curl -s -H "$AUTH" https://your-host/api/skills/1/versions
curl -X POST -H "$AUTH" https://your-host/api/skills/1/versions/3/restore
```

Python:

```python
import requests, tarfile, io
BASE = "https://your-host"
AUTH = {"Authorization": f"Bearer {TOKEN}"}   # 网页「账户」里创建的 token
requests.post(f"{BASE}/api/agent/push", headers=AUTH,
    files={"file": ("my-skill.tar.gz", open("pkg.tgz","rb"), "application/gzip")},
    data={"terminal": "my-machine"})
skills = requests.get(f"{BASE}/api/skills?folder=all", headers=AUTH).json()
```

Bundles (skill combos):

```bash
curl -X POST -H "$AUTH" https://your-host/api/bundles -H 'Content-Type: application/json' -d '{"name":"感知工具箱"}'
curl -X POST -H "$AUTH" https://your-host/api/bundles/1/skills -H 'Content-Type: application/json' -d '{"skill_id":4}'
# Agent 一键安装整个组合（安装脚本运行时同样读取 ASH_TOKEN 或 ~/.ash/token）：
curl -fsSL -H "$AUTH" https://your-host/s/bundle/<bundle-slug>/install.sh | bash
```

Upload whitelist & limits: 扩展名白名单默认为文本类（.md/.json/.py/.sh/.yaml…），可用环境变量 `ASH_ALLOWED_EXTS=.md,.json,…) 覆盖；附属文件单文件 ≤512KB、总量 ≤4MB、数量 ≤200；超限与非白名单文件会被跳过并在响应 `warning` 中提示。推送内容会做轻量安全扫描（curl|sh、反弹 shell、混淆 eval、硬编码密钥等模式），结果随技能保存并在详情页展示；高危命中一律进入人工审核。

## Security notes

- **Accounts and private libraries.** Everything except the landing page, `/login`, `/register`, `/setup.sh`, `/cli.sh` and `/agent.md` requires a session or a token, and every query is scoped to the caller's own library (files live under `STORAGE_DIR/@users/<id>/`).
- **Web sessions** are `HttpOnly; SameSite=Lax` cookies (`Secure` over https), valid 30 days; only a SHA-256 of the session id is stored. Cookie-authenticated writes must carry `X-ASH-Request: 1` and a same-site `Origin`, so cross-site forms can't act as you.
- **API tokens** (`ash_…`) are shown once, stored hashed, revocable from the Account dialog, and can't be used to create tokens or change the password.
- **Passwords** are hashed with scrypt; logins are rate-limited per IP and per username (10 failures / 10 minutes).
- **Upgrading a pre-auth instance:** existing data is migrated but owned by nobody (invisible to every account) until an admin claims it: `npm run user:create -- <name> --admin --claim-legacy` (inside Docker: `docker exec -it ash npm run user:create -- …`). Deploy with `ASH_REGISTRATION=closed` until you've done that.

## Contributing

PRs welcome. Keep changes minimal-diff; UI work should preserve existing keyboard behaviors and pass `npm run test:ui`.

## License

MIT
