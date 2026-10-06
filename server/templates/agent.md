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

- 接到任务时，尤其是**项目特定或不熟悉的流程**（部署、仿真、内部工具、排障手册），先用一两句话描述任务：`ash suggest "<任务描述>"`。它按相关度给出候选并标明「相关 / 可能相关」，没有合适的会直接说没有。
- 技能库中英混写：描述里**中英文关键名词都写上**更容易命中，例如 `ash suggest "测试挂了找根因 test failure root cause"`。
- 知道确切关键词时用 `ash search <关键词…>`（多个关键词需同时命中；都不命中时会给出相关候选）。可以按标签或目录缩小范围：`ash search <关键词> --tag ops`、`ash list --folder DevOps`。
- 搜到相关技能后，先用 `ash info <slug>` 看描述、依赖和文件清单，判断是否适用。
- 只需要阅读说明：`ash show <slug>`。
- 需要执行技能里的脚本：`ash pull <slug>` 安装（会一并安装 `depends_on` 声明的依赖），然后阅读安装目录下的 `SKILL.md` 并按步骤执行。`SKILL.md` 里的相对路径（例如 `scripts/run.sh`）都相对于该目录。
- 一类任务要用到一组技能时，看看有没有现成的组合：`ash bundles`、`ash bundle <标识或名称>`，然后 `ash pull bundle:<标识或名称>`。
- 没搜到合适的技能就按常规方式完成任务，不要硬套不相关的技能。

## 用完回报结果

每次按一个来自本库的技能完成（或没能完成）任务后，回报一次结果。这是技能库知道哪些技能好用、哪些该修的唯一途径：

- 走通了：`ash feedback <slug> ok`
- 没走通：`ash feedback <slug> fail "哪一步、为什么没走通"`——一句具体的原因比一个 fail 有用得多。
- 已经找到了正确做法：修改本地技能目录后 `ash push <目录> --update`，把修正交回库里。

通过 ash 安装的技能，`SKILL.md` 末尾有一行同样的提示。说明里不要写密钥、token 或个人隐私。

## 管理本机已装的技能

- `ash installed` 列出本机通过 ash 安装的技能及状态：最新、有更新、本地有修改、远端已删除。`ash outdated` 只列出需要处理的。
- 开始一项较长的任务前，可以先运行 `ash outdated`；有更新时运行 `ash pull --all`。本地改过的技能会被跳过，不会被覆盖。
- 单独 `ash pull <slug>` 会覆盖本地修改，但会先把旧目录备份到 `~/.ash/backups/`。如果本地修改值得保留，应当推送回库里，而不是只留在本机。
- 不再需要的技能用 `ash remove <slug>` 卸载；不是 ash 安装的目录不会被删除。
- 每个已装技能目录里的 `.ash` 文件记录了来源和版本，不要编辑或删除它。推送时会自动排除这个文件。

## 什么时候推送技能

在你完成了一个**可复用**的流程之后推送：下次还会用到，或者其他机器、其他 Agent 也会用到。以下内容不要推送：一次性的操作记录、只对当前会话有意义的内容，以及任何包含密钥、token、口令或个人隐私的内容。

推送前：

1. 先查重：`ash suggest "<这个新技能要解决的问题>"`。如果已有相近技能，先 `ash pull <slug>` 拉到本地，在原版基础上修改，再运行 `ash push <目录> --update`。
   - 新技能里有些步骤已经是别的技能（尤其是元技能）的内容时，不要复制那些步骤，改为引用（见下文「技能之间的引用」）。
   - 推送结果里提示「库中已有相近技能」或「与元技能相同的命令」时，认真判断：是补充就改为更新已有技能，确实不同就在 description 里写清楚区别。
   - 推送前运行 `ash lint <slug>`（已在库里的技能）自查：双语描述、引用写法、元技能契约、能不能被 Agent 调用。
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
description_en: Use when …  # 另一种语言的描述（description 是英文时写 description_zh）
tags: [ops, debugging]
version: 1.0.0
depends_on: [other-skill]   # 可选，引用的其他技能，写法见下文
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

- **描述要中英双语**：`description` 用你习惯的语言写，再用 `description_en` 或 `description_zh` 补另一种（主描述本身中英混写也可以）。中文任务和英文任务才都能找到它，查重也才能跨语言对上。正文不用写两份：两份正文要同步维护、迟早不一致，而读正文的 Agent 中英文都懂。
  - 给已有技能补双语描述：`ash lint --only bilingual` 列出缺的，逐个 `ash pull` 后加上 `description_en` / `description_zh` 再 `ash push --update`。**只改双语字段的更新直接发布、不用等审核**（Agent 框架不读这些字段，不影响 Agent 的行为）。
- frontmatter 是 YAML：值里含有「: 」时要用引号括起来（`description_en: "Use when: …"`），否则整段 frontmatter 解析失败，名称、描述、依赖全部丢失。
- 脚本放在 `scripts/`，参考资料放在 `references/`，正文里用相对路径引用。
- 只能包含文本文件（.md .sh .py .js .json .yaml 等）。单个文件不超过 512KB，总量不超过 4MB，文件数不超过 200 个；超出限制的文件会被跳过，并在推送结果中提示。
- 推送时服务端会做安全扫描。命中高危模式（反弹 shell、混淆的 eval 等）的技能一律进入人工审核。

## 技能之间的引用

一段操作已经有技能（尤其是元技能）负责时，引用它，不要把它的步骤抄进来——抄过来的两份会漂移，一个坑就要修两处。

**怎么写**（两处都要写）：

1. frontmatter 的 `depends_on` 声明它。`ash pull` 据此把它一并装在本技能旁边；没声明的引用在别的机器上找不到。
2. 正文在用到它的地方写「用元技能 `<slug>`」，后面只写本技能特有的参数和坑：

```markdown
## 编译
> 用元技能 `dev-container-build`
> - target: `//app:main`
> - **本技能特有**：必须加 `--build_tag_filters=sim`，否则会静默用旧二进制
```

也可以写成链接 `[dev-container-build](../dev-container-build/SKILL.md)`。**不要写绝对路径**（`~/.claude/skills/...`），换一台机器或换一个 Agent 就找不到了。

**按技能干活时，遇到「用元技能 `x`」或指向 `../x/SKILL.md` 的链接**，按这个顺序找到它：

1. 在 Claude Code 里：直接调用名为 `x` 的技能；
2. 其他 Agent（或 Claude Code 里调用不到时）：读本技能旁边的 `../x/SKILL.md`——`ash pull` 把引用的技能和本技能链接进同一个 Agent 目录，已装的 `SKILL.md` 末尾也列出了这些链接；
3. 本机没有：运行 `ash pull x`，再按 1 或 2；只想看内容用 `ash show x`。

读完 `x` 按它的步骤做，再回到本技能继续。

**装在哪里**：`ash pull` 把技能只存一份在 `~/.ash/skills/<slug>`（只读，归 ash 管），再在本机每个 Agent 的技能目录里放指向它的链接——Claude Code 的 `~/.claude/skills`、Codex 的 `~/.agents/skills`、Hermes 的 `~/.hermes/skills`（或唯一的 profile）。库里装来的技能和 Agent 自带、自己写的技能因此不混在一起，几个 Agent 用的也是同一个版本。`--agent claude|codex|hermes|dsh` 只链接给那个 Agent（`ASH_AGENT` 设默认）；`--dir` 直接装进指定目录、不建链接。**不要直接改 `~/.ash/skills` 里的文件**：要改就改完 `ash push --update` 回库，或者复制一份到别处再改。`ash doctor` 检查本机：引用的技能链接齐了没有、装的目录有没有 Agent 加载；`ash doctor --fix` 自动补。老版本 ash 装进 Agent 目录的技能、改了名的旧技能、手动复制进去的库技能副本，运行一次 `ash migrate`（先看计划）/ `ash migrate --apply` 统一换成链接，替换前都会备份到 `~/.ash/backups`。

**引用写法**：`slug`（本库）、`@账号/slug`（指定账号，为团队库 / 技能广场预留，目前只能指向自己的账号）、`slug@1.2.0`（固定版本：`ash pull` 从历史里装那一版，`ash pull --all` 不会升级它；版本号由 frontmatter 的 `version` 决定，改了内容要记得升版本号）。

**让引用的技能调用得到**：被引用的技能不要设置 `disable-model-invocation: true`（Claude 就不能调用它了）；`name` 与 slug 保持一致、只用小写字母数字和连字符；description 不超过 1024 个字符。`ash lint` 会检查这些。

**引用的代价**：每多一层引用，Agent 就要多读一个文件、多一个可能断的地方。引用链不要超过两层；一小段、只有一两处用到的步骤，留在原地比抽出去好。

### 什么时候提炼元技能

元技能是被别的技能在流程中引用的基础动作：调用方只说「要做什么」，元技能负责「怎么做」。五条都满足才抽：

1. 已经有 **≥3 个技能**在重复它（真去数，不是「将来可能有」）——第 1 次写在原地，第 2 次忍住，第 3 次才抽；
2. 与业务无关，换个项目也成立；
3. 输入输出一句话说得清；
4. 不含业务判断（「怎么编译」是元技能，「编译结果对不对」不是）；
5. 改一处，所有调用方都受益。

`ash lint` 和推送结果会提示「有 N 条命令（或 N 个步骤）与 a、b 相同」——shell 命令和编号步骤都会比对，那是候选；抽完要**立刻把调用方改成引用它**，否则只是多了一个没人用的技能。

元技能的写法：description 以「【元技能】」开头，写明被引用和被直接要求两种触发场景；正文必须有 **`## 契约`**（输入 / 输出 / 前置 / 失败）和 **`## 被谁引用`** 两节；不要加 `disable-model-invocation: true`（那会让别的技能引用不到它）。

## 命令速查

```
ash suggest "<任务描述>" [--limit N] [--json]
ash search <关键词…> [--tag T] [--folder F] [--json]
ash list [--tag T] [--folder F] [--json]
ash info <slug>
ash show <slug> [--version ID] [--pending]
ash versions <slug>
ash lint [slug] [--only CODE] [--json]
ash bundles | ash bundle <标识或名称>
ash pull <slug>[@版本] [--agent claude|codex|hermes|dsh|all] [--dir PATH] [--pending] [--force] [--no-deps]
ash pull bundle:<标识或名称>
ash pull --all [--dir PATH] [--force]
ash installed | ash outdated [--dir PATH]
ash remove <slug> [--dir PATH] [--force]
ash doctor [--fix] [--dir PATH]
ash push <技能目录|SKILL.md> [--update] [--folder PATH] [--json]
ash mine | ash withdraw <slug>
ash feedback <slug> ok|fail ["说明"]
ash guide
```

默认装进共享存储 `~/.ash/skills`（`$ASH_STORE` 可改），链接给本机每个 Agent（在 Claude Code 里运行时一定包括 `~/.claude/skills`）；`$ASH_AGENT`（claude / codex / hermes / dsh / all）决定默认链接给谁；`$ASH_SKILLS_DIR` 或 `--dir` 不用共享存储，直接装进那个目录。

## 没有 ash 时的 HTTP 接口

所有接口都要带上 `Authorization: Bearer <token>` 请求头（token 见上文「登录」一节），例如：
`curl -fsSL -H "Authorization: Bearer $ASH_TOKEN" __BASE_URL__/s/<slug>/install.sh | bash`

```
GET  __BASE_URL__/api/agent/suggest?q=<任务描述>&format=text           按任务描述找技能（不带 format 返回 JSON）
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
GET  __BASE_URL__/api/agent/lint?slug=<slug>&format=text     技能检查（不带 slug 列出全库有问题的技能）
POST __BASE_URL__/api/agent/feedback                        用完回报：slug=<slug>&outcome=ok|fail&note=<说明>&terminal=<来源>
```
