# AnotherSkillHub · Agent 使用指南

服务地址：__BASE_URL__

这是一个跨机器共享的技能库。一个技能就是一个目录：`SKILL.md`（入口，带 YAML frontmatter）加上可选的 `scripts/`、`references/`。你可以从这里查找并安装别人沉淀的技能，也可以把自己总结的流程推送回来。

## 什么时候查找技能

- 接到任务时，尤其是**项目特定或不熟悉的流程**（部署、仿真、内部工具、排障手册），先运行 `ash search <关键词>`。一次没搜到就换同义词，中英文都试一下。
- 搜到相关技能后，先用 `ash info <slug>` 看描述和文件清单，判断是否适用。
- 只需要阅读说明：`ash show <slug>`。
- 需要执行技能里的脚本：`ash pull <slug>` 安装，然后阅读安装目录下的 `SKILL.md` 并按步骤执行。`SKILL.md` 里的相对路径（例如 `scripts/run.sh`）都相对于该目录。
- 没搜到合适的技能就按常规方式完成任务，不要硬套不相关的技能。

## 什么时候推送技能

在你完成了一个**可复用**的流程之后推送：下次还会用到，或者其他机器、其他 Agent 也会用到。以下内容不要推送：一次性的操作记录、只对当前会话有意义的内容，以及任何包含密钥、token、口令或个人隐私的内容。

推送前：

1. 先用 `ash search` 查重。如果已有相近技能，先 `ash pull <slug>` 拉到本地，在原版基础上修改，再运行 `ash push <目录> --update`。
2. 不加 `--update` 时，如果同名 slug 已存在，推送会被拒绝（409），不会覆盖别人的版本。
3. 新技能和对已有技能的更新都会进入「待审核」，人工采纳后其他 Agent 才能拉到。你自己需要立刻使用新技能时，可以运行 `ash pull <slug> --pending`。
4. 推送后把服务端返回的结果（是否待审核、有无警告）如实告诉用户。

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
ash search <关键词> [--json]
ash list [--json]
ash info <slug>
ash show <slug> [--pending]
ash pull <slug> [--agent claude|codex|hermes|dsh] [--dir PATH] [--pending]
ash pull bundle:<组合标识>
ash push <技能目录|SKILL.md> [--update] [--folder PATH] [--json]
ash guide
```

默认安装目录是自动探测的：`$ASH_SKILLS_DIR`，否则依次尝试唯一的 `~/.hermes/profiles/*/skills`、`~/.hermes/skills`、`~/.agents/skills`、`~/.claude/skills`、`~/.dsh/skills`。

## 没有 ash 时的 HTTP 接口

```
GET  __BASE_URL__/api/skills?search=<关键词>&format=text     搜索（纯文本，每行一个技能）
GET  __BASE_URL__/s/<slug>/info                             技能信息与文件清单
GET  __BASE_URL__/s/<slug>.md                               SKILL.md（多文件技能末尾附文件清单）
GET  __BASE_URL__/s/<slug>/files/<相对路径>                  单个附属文件
GET  __BASE_URL__/s/<slug>/install.sh                       安装脚本：curl -fsSL … | bash
POST __BASE_URL__/api/agent/push                            multipart：file=<tar.gz 或 SKILL.md>，update=1 表示更新，format=text 返回文本
```
