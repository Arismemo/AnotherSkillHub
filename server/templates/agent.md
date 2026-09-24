# AnotherSkillHub · Agent 使用指南

服务地址：__BASE_URL__（面向人的完整文档：__BASE_URL__/docs）

这是一个跨机器共享的技能库。一个技能就是一个目录：`SKILL.md`（入口，带 YAML frontmatter）加上可选的 `scripts/`、`references/`。你可以从这里查找并安装别人沉淀的技能，也可以把自己总结的流程推送回来。

## 登录

每个账号有自己的私有技能库，所有命令都以登录的账号身份执行。先运行 `ash whoami` 确认已登录。
如果提示未登录，**不要替用户输入密码**，而是请用户做以下任意一步：
- 在终端里运行 `ash login`，输入用户名和密码；
- 或者在网页「账户」里创建一个 API token，然后运行 `ash login --token <token>`。

token 保存在 `~/.ash/token`，也可以通过环境变量 `ASH_TOKEN` 提供。它等同于账号的访问权限，不要打印、提交或推送进任何技能。

## 什么时候查找技能

- 接到任务时，尤其是**项目特定或不熟悉的流程**（部署、仿真、内部工具、排障手册），先运行 `ash search <关键词>`。一次没搜到就换同义词，中英文都试一下。
- 可以按标签或目录缩小范围：`ash search <关键词> --tag ops`、`ash list --folder DevOps`。
- 搜到相关技能后，先用 `ash info <slug>` 看描述、依赖和文件清单，判断是否适用。
- 只需要阅读说明：`ash show <slug>`。
- 需要执行技能里的脚本：`ash pull <slug>` 安装（会一并安装 `depends_on` 声明的依赖），然后阅读安装目录下的 `SKILL.md` 并按步骤执行。`SKILL.md` 里的相对路径（例如 `scripts/run.sh`）都相对于该目录。
- 一类任务要用到一组技能时，看看有没有现成的组合：`ash bundles`、`ash bundle <标识或名称>`，然后 `ash pull bundle:<标识或名称>`。
- 没搜到合适的技能就按常规方式完成任务，不要硬套不相关的技能。

## 管理本机已装的技能

- `ash installed` 列出本机通过 ash 安装的技能及状态：最新、有更新、本地有修改、远端已删除。`ash outdated` 只列出需要处理的。
- 开始一项较长的任务前，可以先运行 `ash outdated`；有更新时运行 `ash pull --all`。本地改过的技能会被跳过，不会被覆盖。
- 单独 `ash pull <slug>` 会覆盖本地修改，但会先把旧目录备份到 `~/.ash/backups/`。如果本地修改值得保留，应当推送回库里，而不是只留在本机。
- 不再需要的技能用 `ash remove <slug>` 卸载；不是 ash 安装的目录不会被删除。
- 每个已装技能目录里的 `.ash` 文件记录了来源和版本，不要编辑或删除它。推送时会自动排除这个文件。

## 什么时候推送技能

在你完成了一个**可复用**的流程之后推送：下次还会用到，或者其他机器、其他 Agent 也会用到。以下内容不要推送：一次性的操作记录、只对当前会话有意义的内容，以及任何包含密钥、token、口令或个人隐私的内容。

推送前：

1. 先用 `ash search` 查重。如果已有相近技能，先 `ash pull <slug>` 拉到本地，在原版基础上修改，再运行 `ash push <目录> --update`。
2. 不加 `--update` 时，如果同名 slug 已存在，推送会被拒绝（409），不会覆盖别人的版本。
3. 新技能和对已有技能的更新都会进入「待审核」，人工采纳后其他 Agent 才能拉到。你自己需要立刻使用新技能时，可以运行 `ash pull <slug> --pending`。
4. 推送后把服务端返回的结果（是否待审核、有无警告）如实告诉用户。
5. 之后用 `ash mine` 查看你（本机）推送的技能的审核结果。推送有误时，用 `ash withdraw <slug>` 撤回仍在待审的推送；已发布的内容不能撤回，只能再推送一次更新。

需要查看或对比旧版本时：`ash versions <slug>` 列出历史版本，`ash show <slug> --version <id>` 查看其中一个。回滚由人在网页上操作。

## SKILL.md 规范

```markdown
---
name: my-skill              # 必填。英文 slug，只含小写字母/数字/-/_，也是安装目录名
description: 一句话说明「什么时候应该使用这个技能」，Agent 靠它判断是否调用
tags: [ops, debugging]
version: 1.0.0
depends_on: [other-skill]   # 可选，依赖的其他技能 slug
---

# 人类可读的标题

## 何时使用
触发条件和适用范围。

## 步骤
1. 具体、可执行的命令或操作
2. …

## 验证
怎样确认完成，以及常见失败的处理办法。
```

- 脚本放在 `scripts/`，参考资料放在 `references/`，正文里用相对路径引用。
- 只能包含文本文件（.md .sh .py .js .json .yaml 等）。单个文件不超过 512KB，总量不超过 4MB，文件数不超过 200 个；超出限制的文件会被跳过，并在推送结果中提示。
- 推送时服务端会做安全扫描。命中高危模式（反弹 shell、混淆的 eval 等）的技能一律进入人工审核。

## 命令速查

```
ash search <关键词…> [--tag T] [--folder F] [--json]
ash list [--tag T] [--folder F] [--json]
ash info <slug>
ash show <slug> [--version ID] [--pending]
ash versions <slug>
ash bundles | ash bundle <标识或名称>
ash pull <slug> [--agent claude|codex|hermes|dsh] [--dir PATH] [--pending] [--force] [--no-deps]
ash pull bundle:<标识或名称>
ash pull --all [--dir PATH] [--force]
ash installed | ash outdated [--dir PATH]
ash remove <slug> [--dir PATH] [--force]
ash push <技能目录|SKILL.md> [--update] [--folder PATH] [--json]
ash mine | ash withdraw <slug>
ash guide
```

默认安装目录是自动探测的：`$ASH_SKILLS_DIR`，否则依次尝试唯一的 `~/.hermes/profiles/*/skills`、`~/.hermes/skills`、`~/.agents/skills`、`~/.claude/skills`、`~/.dsh/skills`。

## 没有 ash 时的 HTTP 接口

所有接口都要带上 `Authorization: Bearer <token>` 请求头（token 见上文「登录」一节），例如：
`curl -fsSL -H "Authorization: Bearer $ASH_TOKEN" __BASE_URL__/s/<slug>/install.sh | bash`

```
GET  __BASE_URL__/api/skills?search=<关键词>&tag=&folder=&format=text   搜索（纯文本，每行一个技能）
GET  __BASE_URL__/s/<slug>/info                             技能信息、依赖与文件清单
GET  __BASE_URL__/s/<slug>.md                               SKILL.md（多文件技能末尾附文件清单；?version=<id> 取历史版本）
GET  __BASE_URL__/s/<slug>/files/<相对路径>                  单个附属文件
GET  __BASE_URL__/s/<slug>/versions                         历史版本列表
GET  __BASE_URL__/s/<slug>/install.sh                       安装脚本：curl -fsSL … | bash（?nodeps=1 不装依赖，?force=1 不备份）
GET  __BASE_URL__/api/bundles?format=text                   技能组合列表
GET  __BASE_URL__/api/bundles/<标识或名称>?format=text       组合成员
GET  __BASE_URL__/s/bundle/<标识或名称>/install.sh           安装整个组合
POST __BASE_URL__/api/agent/push                            multipart：file=<tar.gz 或 SKILL.md>，update=1 表示更新，terminal=<来源>，format=text
GET  __BASE_URL__/api/agent/mine?terminal=<来源>              我的推送及审核状态
POST __BASE_URL__/api/agent/withdraw                        撤回待审推送：slug=<slug>&terminal=<来源>
GET  __BASE_URL__/api/agent/revisions?slug=a&slug=b         已装技能比对：每行 slug、状态、修订号、版本
```
