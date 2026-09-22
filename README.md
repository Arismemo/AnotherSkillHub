# SkillHub - 统一 Agent 技能管理中心

SkillHub 是一个专为多终端 AI Agent 设计的统一技能管理中心。具有**类似邮箱与笔记的多级分类管理**、**收件箱 (Inbox) 流转**、**终端 Agent 读写 API** 以及**一键复制即用**能力。

---

## 核心特性

1. **邮箱与笔记式多级管理**：
   - 📥 **Inbox 收件箱**：所有新 push 或未分类的 Skill 默认汇聚在 Inbox，带有未整理数字红点提示。
   - 📁 **多级嵌套文件夹**：支持任意层级的新建、重命名、删除，并支持将技能在不同目录间移动、剪切、复制。
   - ⭐ **收藏夹与软删除**：支持常用技能打星置顶，删除操作移入废纸篓，可随时一键恢复。
   - 🏷️ **标签云**：支持打标签并快速聚合筛选。

2. **一键复制发送给 Agent（即用）**：
   - **智能链接**：复制 `https://skillhub.709970.xyz/s/{slug}` 发送给任意 Agent。Agent 调用 web 提取工具打开该链接时，SkillHub 会智能识别并返回最精简、规范的 Markdown 指令，Agent 一秒吸纳并立即执行。
   - **CLI 安装命令**：复制 `curl -fsSL https://skillhub.709970.xyz/s/{slug}/install.sh | bash`，自动检测本地环境（Hermes / Codex / Claude Code）并安装到技能目录。

3. **任意终端 Agent 读写 API**：
   - **读取**：
     - `GET /s/{slug}`：智能协议适配（网页浏览器跳转 UI，Agent / curl 返回 Markdown）
     - `GET /s/{slug}.md`：纯 Markdown
     - `GET /s/{slug}/install.sh`：自动安装脚本
     - `GET /api/skills/{slug}`：全量 JSON 元数据
   - **写入 (Push to Inbox)**：
     - `POST /api/skills`：上传 JSON 载荷
     - `POST /api/agent/push`：极简 multipart 上传 `SKILL.md`

4. **双轨持久化**：
   - SQLite 高性能索引 + 物理文件树 `data/storage/{folder_path}/{slug}/SKILL.md`，透明且易于维护。

---

## 快速上手与使用

### 1. Agent 写入技能到 SkillHub (默认进入 Inbox)
在终端或 Agent 中运行：
```bash
# 方式 A：单行 curl 直接推送到收件箱
curl -X POST https://skillhub.709970.xyz/api/skills \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-cool-skill",
    "name": "我的新技能",
    "description": "技能简要描述与触发条件",
    "tags": ["planning", "test"],
    "content": "# 我的新技能\n详细指令与步骤...",
    "terminal_source": "Mac-Hermes"
  }'

# 方式 B：上传本地已有的 SKILL.md
curl -X POST https://skillhub.709970.xyz/api/agent/push \
  -F "file=@SKILL.md" \
  -F "terminal=ThinkPad-ADU"
```

### 2. 在 Web 端整理与管理
1. 访问：https://skillhub.709970.xyz
2. 点击左侧 **📥 收件箱 (Inbox)**，查看终端刚刚同步上来的新技能。
3. 点击技能卡片，可以在右侧预览、在线编辑内容、修改标签。
4. 点击顶部的 **`移动到文件夹`**，选择或者新建你的目标目录（如 `ADL4/Planning`），完成技能归档整理！

### 3. 分享给 Agent 使用
1. 在网页详情页顶部，点击 **`[ 📋 复制 Agent 加载指令 ]`**。
2. 将复制好的指令粘贴给任意 Agent 终端（如 Hermes 对话框、Claude Code 等）：
   > `请加载并使用技能：https://skillhub.709970.xyz/s/voyager-worldsim`
3. Agent 打开该链接获取完整 prompt 指令，立即掌握该技能！
