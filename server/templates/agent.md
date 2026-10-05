# AnotherSkillHub · Agent 使用指南

服务地址：__BASE_URL__ · 完整规范：`ash guide --full`（__BASE_URL__/agent-full.md）

跨机器共享的技能库。一个技能是一个目录：`SKILL.md`（带 YAML frontmatter）加可选的 `scripts/`、`references/`。

## 登录

先 `ash whoami`。提示未登录时**不要替用户输入密码**：请用户运行 `ash login`，或在网页「账户」创建 token 后运行 `ash login --token <token>`。不要打印 token，也不要把它写进任何技能。

## 什么时候查找技能

- 接到项目特定或不熟悉的任务（部署、仿真、内部工具、排障）时，先 `ash suggest "<一两句话描述任务，中英文关键词都写上>"`。知道确切关键词时用 `ash search <关键词…>`。
- 用 `ash info <slug>` 判断是否适用。只看说明用 `ash show <slug>`；要执行脚本用 `ash pull <slug>`（会一并装上依赖），再按安装目录下的 `SKILL.md` 执行。
- 没有合适的就按常规方式完成，不要硬套。

## 用完回报结果

按本库的技能完成（或没能完成）任务后，必须回报一次。这是技能库知道哪些技能该修的唯一途径：

- 走通了：`ash feedback <slug> ok`
- 没走通：`ash feedback <slug> fail "哪一步、为什么没走通"`
- 已经找到正确做法：修改本地技能目录后 `ash push <目录> --update`

## 什么时候推送技能

完成了一个下次还会用到的流程后推送。一次性的操作记录、任何密钥、token 或个人隐私都不要推送。

1. 先查重：`ash suggest "<新技能要解决的问题>"`。已有相近的就 `ash pull <slug>`，改完 `ash push <目录> --update`。
2. `ash push <目录>`。同名技能已存在时必须加 `--update`。推送后进入待审核；自己要马上用就 `ash pull <slug> --pending`。
3. 把返回结果（是否待审核、有无警告）如实告诉用户。之后用 `ash mine` 查看审核结果。

最小的 `SKILL.md`：

```markdown
---
name: my-skill            # 英文 slug：小写字母、数字、-、_
description: 什么时候使用这个技能（再用 description_en 写一句英文）
version: 1.0.0
depends_on: [other-skill] # 可选：引用的其他技能
---

## 何时使用
## 步骤
## 验证
```

**写新技能、在技能里引用别的技能、提炼元技能、处理 `ash installed` / `ash doctor` 的问题、没有 ash 只能用 HTTP 时，先读完整规范：`ash guide --full`。**
