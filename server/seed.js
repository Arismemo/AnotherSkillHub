const db = require('./db');
const { saveSkillToDisk } = require('./storage');

// 新用户的示例库：注册时放几份通用示例，方便体验归档、审核与 Agent 拉取流程（ASH_SEED=0 关闭）
function seedUserLibrary(userId) {
  if (process.env.ASH_SEED === '0') return;
  const skillCount = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE user_id = ?`).get(userId).count;
  if (skillCount > 0) return;

  const insertFolder = db.prepare(`INSERT OR IGNORE INTO folders (user_id, path, name, parent_path) VALUES (?, ?, ?, ?)`);
  insertFolder.run(userId, 'Engineering', 'Engineering 工程实践', '');
  insertFolder.run(userId, 'Meta', 'Meta 元技能', '');

  const insertSkill = db.prepare(`
    INSERT INTO skills (user_id, slug, name, description, folder_path, tags, content, terminal_source, is_starred, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seeds = [
    {
      slug: 'writing-skills',
      name: '如何编写一个好技能',
      description: '需要把一个可复用流程沉淀成 SKILL.md 并推送到技能库时使用',
      folder_path: 'Meta',
      tags: ['meta', 'authoring'],
      is_starred: 1,
      content: `---
name: writing-skills
description: 需要把一个可复用流程沉淀成 SKILL.md 并推送到技能库时使用
tags: [meta, authoring]
version: 1.0.0
---

# 如何编写一个好技能

## 何时使用
完成了一个下次还会用到、或其他 Agent 也会用到的流程之后。

## 步骤
1. \`ash search <关键词>\` 查重；已有相近技能就 \`ash pull\` 下来在原版上改。
2. frontmatter 的 \`name\` 用英文 slug，\`description\` 写「什么时候用」而不是「是什么」。
3. 正文分「何时使用 / 步骤 / 验证」三段，步骤写成可直接执行的命令。
4. 脚本放 \`scripts/\`，参考资料放 \`references/\`，正文用相对路径引用。
5. 不写入任何密钥或口令。
6. \`ash push <技能目录>\`（更新已有技能加 \`--update\`），把返回的审核状态告诉用户。

## 验证
- \`ash show <slug> --pending\` 能看到完整正文
- 另一台机器 \`ash pull <slug> --pending\` 后脚本可直接运行
`,
    },
    {
      slug: 'systematic-debugging',
      name: 'Systematic Debugging 四步根因排查',
      description: '遇到原因不明的 bug、测试失败或异常行为，准备动手修之前使用',
      folder_path: 'Engineering',
      tags: ['debugging', 'root-cause'],
      is_starred: 1,
      content: `---
name: systematic-debugging
description: 遇到原因不明的 bug、测试失败或异常行为，准备动手修之前使用
tags: [debugging, root-cause]
version: 1.0.0
depends_on: [writing-skills]
---

# Systematic Debugging 四步根因排查

## 何时使用
任何「看起来改一下就好」但还没弄清原因的问题。

## 步骤
1. **复现**：写出最小复现步骤，确认每次都能触发。
2. **定位**：二分输入、提交或代码路径，缩小到一个函数或一行。
3. **解释**：用一句话说明根因；说不清就回到第 2 步。
4. **修复并验证**：先写能失败的测试，再修，确认测试转绿且没有引入回归。

## 验证
- 复现步骤在修复后不再触发
- 新增测试在修复前失败、修复后通过
`,
    },
    {
      slug: 'release-checklist',
      name: '发布前检查清单',
      description: '准备发布新版本或部署到生产环境之前使用',
      folder_path: 'inbox',
      tags: ['release', 'ops'],
      is_starred: 0,
      content: `---
name: release-checklist
description: 准备发布新版本或部署到生产环境之前使用
tags: [release, ops]
version: 1.0.0
---

# 发布前检查清单

## 步骤
- [ ] 所有测试、lint、构建在 CI 上通过
- [ ] 变更日志已更新，破坏性变更单独标注
- [ ] 数据库迁移可回滚，并已在预发环境演练
- [ ] 回滚方案与负责人已确认
- [ ] 发布后观察核心指标 15 分钟
`,
    },
  ];

  seeds.forEach((s) => {
    insertSkill.run(userId, s.slug, s.name, s.description, s.folder_path, JSON.stringify(s.tags), s.content, 'Seed', s.is_starred, '1.0.0');
    saveSkillToDisk(userId, s.folder_path, s.slug, s.content, []);
  });
}

module.exports = { seedUserLibrary };
