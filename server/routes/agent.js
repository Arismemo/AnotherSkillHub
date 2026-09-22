const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db');
const { parseSkillContent, saveSkillToDisk, createSkillArchive, createSkillTarGzArchive } = require('../storage');

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

// 获取服务基础主机 URL
function getBaseUrl(req) {
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  return `${proto}://${host}`;
}

// 智能短链：/s/:slug 或 /s/:slug.md
router.get('/:slug', (req, res) => {
  try {
    let slug = req.params.slug;
    let isExplicitMarkdown = false;
    if (slug.endsWith('.md')) {
      slug = slug.replace(/\.md$/, '');
      isExplicitMarkdown = true;
    }

    const skill = db.prepare(`SELECT * FROM skills WHERE slug = ? AND is_deleted = 0`).get(slug);
    if (!skill) {
      return res.status(404).send('# Error: Skill not found\nThe requested skill does not exist or has been removed.\n');
    }

    const acceptHeader = req.get('accept') || '';
    const userAgent = req.get('user-agent') || '';
    const format = req.query.format;

    const isCurlOrAgent = userAgent.includes('curl') || 
                         userAgent.includes('Wget') || 
                         userAgent.includes('Hermes') || 
                         userAgent.includes('Python') ||
                         userAgent.includes('Claude') ||
                         acceptHeader.includes('text/markdown') ||
                         format === 'md' ||
                         isExplicitMarkdown;

    // 如果是 Agent 或命令行抓取，返回纯 Markdown
    if (isCurlOrAgent) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      
      // 组装标准技能 Markdown 格式
      let output = skill.content;
      return res.send(output);
    }

    // 否则如果是浏览器访问，重定向到前端页面并高亮选中该 skill
    return res.redirect(`/?skill=${slug}`);
  } catch (err) {
    res.status(500).send('# Internal Server Error\n' + err.message);
  }
});

// 一键安装脚本：/s/:slug/install.sh (自动完整安装技能目录，包含附属脚本与文档)
router.get('/:slug/install.sh', (req, res) => {
  try {
    const slug = req.params.slug;
    const skill = db.prepare(`SELECT * FROM skills WHERE slug = ? AND is_deleted = 0`).get(slug);
    if (!skill) {
      return res.status(404).send('#!/bin/bash\necho "Skill not found"\nexit 1\n');
    }

    const baseUrl = getBaseUrl(req);
    const script = `#!/bin/bash
set -e
set -o pipefail

SKILL_NAME="${slug}"
BASE_URL="${baseUrl}"

echo "================================================="
echo "  📦 AnotherSkillHub: 正在安装技能 [\$SKILL_NAME]"
echo "================================================="

# 检测本地已有的技能目录
INSTALL_DIR=""
if [ -d "\$HOME/.hermes/profiles/inceptio-general/skills" ]; then
    INSTALL_DIR="\$HOME/.hermes/profiles/inceptio-general/skills/\$SKILL_NAME"
elif [ -d "\$HOME/.hermes/skills" ]; then
    INSTALL_DIR="\$HOME/.hermes/skills/\$SKILL_NAME"
elif [ -d "\$HOME/.agents/skills" ]; then
    INSTALL_DIR="\$HOME/.agents/skills/\$SKILL_NAME"
else
    # 默认创建在 ~/.hermes/skills
    mkdir -p "\$HOME/.hermes/skills"
    INSTALL_DIR="\$HOME/.hermes/skills/\$SKILL_NAME"
fi

mkdir -p "\$INSTALL_DIR"
echo "目标安装目录: \$INSTALL_DIR"

# 尝试下载完整归档 (包含脚本 scripts/ 与文档 references/)
# 归档顶层带 <slug>/ 目录，--strip-components=1 去掉，避免嵌套成 <slug>/<slug>/
echo "正在从云端拉取完整技能包..."
if curl -fsSL "\$BASE_URL/s/\$SKILL_NAME/archive.tar.gz" | tar -xz -C "\$INSTALL_DIR" --strip-components=1 2>/dev/null; then
    echo "✓ 完整技能归档解压成功"
else
    echo "注意：未找到多文件归档，正在拉取核心 SKILL.md..."
    curl -fsSL "\$BASE_URL/s/\$SKILL_NAME.md" -o "\$INSTALL_DIR/SKILL.md"
fi

# 兼容旧版脚本安装过的嵌套目录：<INSTALL_DIR>/<slug>/... 拍平到根
if [ -d "\$INSTALL_DIR/\$SKILL_NAME" ]; then
    mv "\$INSTALL_DIR/\$SKILL_NAME"/* "\$INSTALL_DIR/" 2>/dev/null || true
    rmdir "\$INSTALL_DIR/\$SKILL_NAME" 2>/dev/null || true
    echo "✓ 已修正历史版本的嵌套目录结构"
fi

# 如果有 scripts 目录，自动赋予执行权限
if [ -d "\$INSTALL_DIR/scripts" ]; then
    chmod +x "\$INSTALL_DIR/scripts"/* 2>/dev/null || true
    echo "✓ 已自动赋予脚本执行权限 (chmod +x scripts/*)"
fi

echo "================================================="
echo "✅ 技能 [\$SKILL_NAME] 安装完毕，开箱即用！"
echo "================================================="
`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(script);
  } catch (err) {
    res.status(500).send('#!/bin/bash\necho "Server error"\nexit 1\n');
  }
});

// 打包下载 tar.gz：/s/:slug/archive.tar.gz (专为终端与 Agent 流式解压设计)
router.get('/:slug/archive.tar.gz', (req, res) => {
  try {
    const slug = req.params.slug;
    const skill = db.prepare(`SELECT * FROM skills WHERE slug = ?`).get(slug);
    if (!skill) return res.status(404).send('Skill not found');

    res.attachment(`${slug}.tar.gz`);
    createSkillTarGzArchive(skill.folder_path, slug, res);
  } catch (err) {
    res.status(500).send('Error archiving skill: ' + err.message);
  }
});

// 打包下载 ZIP：/s/:slug/download
router.get('/:slug/download', (req, res) => {
  try {
    const slug = req.params.slug;
    const skill = db.prepare(`SELECT * FROM skills WHERE slug = ?`).get(slug);
    if (!skill) return res.status(404).send('Skill not found');

    res.attachment(`${slug}.zip`);
    createSkillArchive(skill.folder_path, slug, res);
  } catch (err) {
    res.status(500).send('Error archiving skill: ' + err.message);
  }
});

// Agent 一键 Push 上传端点 (支持 JSON 或 FormData 上传)
router.post('/push', upload.single('file'), (req, res) => {
  try {
    let content = '';
    let name = req.body.name;
    let slug = req.body.slug;
    let description = req.body.description;
    let terminalSource = req.body.terminal || req.body.terminal_source || 'Agent-CLI';
    let folderPath = req.body.folder || req.body.folder_path || 'inbox'; // 默认进入 inbox

    if (req.file) {
      content = req.file.buffer.toString('utf8');
      if (!name && req.file.originalname) {
        name = req.file.originalname.replace(/\.md$/i, '');
      }
    } else if (req.body.content) {
      content = req.body.content;
    }

    if (!content) {
      return res.status(400).json({ error: 'Missing skill content or file' });
    }

    const parsed = parseSkillContent(content);
    if (!name && parsed.data.name) name = parsed.data.name;
    if (!description && parsed.data.description) description = parsed.data.description;
    if (!slug && parsed.data.name) slug = parsed.data.name;
    if (!slug && name) slug = name;

    slug = (slug || 'skill-' + Date.now()).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    name = name || slug;

    // 检查是否已有同名
    const existing = db.prepare(`SELECT id, folder_path FROM skills WHERE slug = ?`).get(slug);

    if (existing) {
      db.prepare(`
        UPDATE skills 
        SET name = ?, description = ?, content = ?, terminal_source = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, description || '', content, terminalSource, existing.id);

      saveSkillToDisk(existing.folder_path, slug, content, []);
      return res.json({
        success: true,
        action: 'updated',
        slug,
        folder_path: existing.folder_path,
        url: `${getBaseUrl(req)}/s/${slug}`
      });
    }

    const stmt = db.prepare(`
      INSERT INTO skills (slug, name, description, folder_path, tags, content, terminal_source)
      VALUES (?, ?, ?, ?, '[]', ?, ?)
    `);
    stmt.run(slug, name, description || '', folderPath, content, terminalSource);

    saveSkillToDisk(folderPath, slug, content, []);

    res.status(201).json({
      success: true,
      action: 'created',
      slug,
      folder_path: folderPath,
      url: `${getBaseUrl(req)}/s/${slug}`,
      install_cmd: `curl -fsSL ${getBaseUrl(req)}/s/${slug}/install.sh | bash`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
