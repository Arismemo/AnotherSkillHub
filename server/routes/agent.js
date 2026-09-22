const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const multer = require('multer');
const db = require('../db');
const { parseSkillContent, saveSkillToDisk, createSkillArchive, createSkillTarGzArchive } = require('../storage');

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });

// A9: 轻量安全扫描——高危模式给 warning（不阻塞）
const SECURITY_PATTERNS = [
  { re: /rm\s+-rf\s+[~/]??\s*$/m, msg: '包含 rm -rf 指向根/家目录的危险写法' },
  { re: /curl[^|;]*\|\s*(ba)?sh/g, msg: '包含 curl|sh 远程执行（若非自有服务安装脚本请人工确认）' },
  { re: /wget[^|;]*\|\s*(ba)?sh/g, msg: '包含 wget|sh 远程执行' },
  { re: /(eval|exec)\s*\(.{0,40}(base64|\\x)/gi, msg: '包含 base64/十六进制混淆的 eval/exec' },
  { re: /(?:aws_secret_access_key|api[_-]?key|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+\/_-]{16,}/gi, msg: '疑似硬编码密钥' },
  { re: /\bnc\s+-e|reverse[_-]?shell|bash\s+-i\s+>&\s*\/dev\/tcp/gi, msg: '疑似反弹 shell' },
];
function securityScan(text) {
  const hits = [];
  for (const p of SECURITY_PATTERNS) {
    if (p.re.test(text)) hits.push(p.msg);
  }
  return hits;
}

// 获取服务基础主机 URL
function getBaseUrl(req) {
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  return `${proto}://${host}`;
}

// 技能组合一键安装：/s/bundle/:slug/install.sh —— 依次安装组合内全部技能
router.get('/bundle/:slug/install.sh', (req, res) => {
  const bundle = db.prepare('SELECT * FROM bundles WHERE slug = ?').get(req.params.slug);
  if (!bundle) return res.status(404).send('#!/bin/bash\necho "Bundle not found"\nexit 1\n');
  const items = db.prepare(`
    SELECT s.slug, s.name FROM bundle_items bi JOIN skills s ON s.id = bi.skill_id
    WHERE bi.bundle_id = ? AND s.is_deleted = 0 ORDER BY bi.added_at DESC
  `).all(bundle.id);
  if (!items.length) return res.status(400).send('#!/bin/bash\necho "Bundle is empty"\nexit 1\n');

  const baseUrl = getBaseUrl(req);
  // 透传 agent/dir 参数给组合内每个技能的 install.sh
  const subQuery = new URLSearchParams();
  if (req.query.agent) subQuery.set('agent', req.query.agent);
  if (req.query.dir) subQuery.set('dir', req.query.dir);
  const agentQ = subQuery.toString() ? `?${subQuery.toString()}` : '';
  const installs = items.map((it) => `  echo "--- [\${i}/\${N}] ${it.name} (${it.slug})"; curl -fsSL "\${BASE_URL}/s/${it.slug}/install.sh${agentQ}" | bash`).join('\n');
  const script = `#!/bin/bash
set -e
set -o pipefail
BASE_URL="${baseUrl}"
N=${items.length}
i=0
echo "========================================================="
echo "  📦 AnotherSkillHub 技能组合 [${bundle.name}] —— 共 \${N} 个技能"
echo "========================================================="
install_one() {
  i=\$((i+1))
${installs}
}
install_one
echo "========================================================="
echo "✅ 技能组合 [${bundle.name}] 全部安装完毕（\${N} 个技能）！"
echo "========================================================="
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(script);
});

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
    // ?version=<id> 拉取历史版本内容
    if (req.query.version) {
      const ver = db.prepare('SELECT * FROM skill_versions WHERE id = ? AND skill_id = ?').get(req.query.version, skill.id);
      if (ver) {
        return res.setHeader('Content-Type', 'text/markdown; charset=utf-8') && res.send(ver.content);
      }
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
// 查询参数: agent=hermes|codex|claude|dsh 指定安装目标；dir=/path 自定义目录
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
AGENT_TARGET="${req.query.agent || 'auto'}"
CUSTOM_DIR="${(req.query.dir || '').replace(/"/g, '')}"

echo "================================================="
echo "  📦 AnotherSkillHub: 正在安装技能 [\$SKILL_NAME]"
echo "================================================="

# 安装目标选择：ash pull <slug> --agent <name> [--dir /path] 透传为 AGENT/DIR 参数
AGENT_TARGET="\${AGENT_TARGET:-auto}"
CUSTOM_DIR="\${CUSTOM_DIR:-}"
SKILLS_ROOT=""
case "\$AGENT_TARGET" in
  hermes)
    SKILLS_ROOT="\$HOME/.hermes/skills";;
  codex)
    SKILLS_ROOT="\$HOME/.agents/skills";;
  claude)
    SKILLS_ROOT="\$HOME/.claude/skills";;
  dsh)
    SKILLS_ROOT="\$HOME/.dsh/skills";;
  *)
    # 自动检测
    if [ -d "\$HOME/.hermes/profiles/inceptio-general/skills" ]; then SKILLS_ROOT="\$HOME/.hermes/profiles/inceptio-general/skills"
    elif [ -d "\$HOME/.hermes/skills" ]; then SKILLS_ROOT="\$HOME/.hermes/skills"
    elif [ -d "\$HOME/.agents/skills" ]; then SKILLS_ROOT="\$HOME/.agents/skills"
    elif [ -d "\$HOME/.claude/skills" ]; then SKILLS_ROOT="\$HOME/.claude/skills"
    elif [ -d "\$HOME/.dsh/skills" ]; then SKILLS_ROOT="\$HOME/.dsh/skills"
    else SKILLS_ROOT="\$HOME/.hermes/skills"; fi;;
esac
if [ -n "\$CUSTOM_DIR" ]; then
    INSTALL_DIR="\$CUSTOM_DIR/\$SKILL_NAME"
else
    mkdir -p "\$SKILLS_ROOT"
    INSTALL_DIR="\$SKILLS_ROOT/\$SKILL_NAME"
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

// 解包技能归档（tar.gz/tgz）：返回 { content, files }——SKILL.md 为正文，其余为附属文件
// A6: 扩展名白名单（可用环境变量 ASH_ALLOWED_EXTS 覆盖，逗号分隔）
const ALLOWED_EXTS = (process.env.ASH_ALLOWED_EXTS
  ? process.env.ASH_ALLOWED_EXTS.split(',').map((e) => e.trim().toLowerCase())
  : ['.md', '.json', '.yaml', '.yml', '.toml', '.txt', '.sh', '.bash', '.zsh', '.py', '.js', '.ts', '.mjs', '.cjs', '.css', '.html', '.xml', '.sql', '.ini', '.cfg', '.conf', '.csv', '.xsd', '.xsl', '.dtd', '.svg']);
const DENY_EXTS = ['.exe', '.dll', '.so', '.dylib', '.bin', '.img', '.iso', '.zip', '.tar.gz', '.tgz', '.7z', '.rar', '.pdf', '.doc', '.xls', '.ppt', '.key', '.pem', '.p12', '.env', '.git'];

function extAllowed(name) {
  const lower = name.toLowerCase();
  if (DENY_EXTS.some((e) => lower.endsWith(e))) return false;
  if (lower === 'dockerfile' || lower === 'makefile' || lower.startsWith('.')) return true; // 无扩展名常见配置文件
  return ALLOWED_EXTS.some((e) => lower.endsWith(e));
}

function extractSkillArchive(buffer) {
  const os = require('os');
  const MAX_TOTAL_TEXT = 4 * 1024 * 1024;   // 附属文本总量 4MB
  const MAX_FILES = 200;                     // 附属文件数上限
  const MAX_FILE = 512 * 1024;               // 单文件 512KB

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-archive-'));
  try {
    const tmpTar = path.join(tmpDir, 'skill.tgz');
    fs.writeFileSync(tmpTar, buffer);
    // 路径穿越防护：先列出成员校验再解包
    let listing = '';
    try {
      listing = execSync(`tar -tzf ${shellQuote(tmpTar)}`, { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }).toString();
    } catch {
      return { error: '归档损坏或不是有效的 tar.gz' };
    }
    const members = listing.split('\n').filter(Boolean);
    for (const m of members) {
      const norm = path.posix.normalize(m.replace(/\/$/, ''));
      if (norm === '..' || norm.startsWith('../') || path.posix.isAbsolute(norm)) {
        return { error: `归档包含非法路径: ${m}` };
      }
    }
    if (members.length > MAX_FILES + 50) {
      return { error: `归档文件数过多（${members.length} > ${MAX_FILES + 50}）` };
    }
    execSync(`tar -xzf ${shellQuote(tmpTar)} -C ${shellQuote(tmpDir)}`, { stdio: 'pipe' });

    // 若解包后只有一个根目录（skill-name/），下钻一层
    let root = tmpDir;
    const entries = fs.readdirSync(tmpDir).filter((e) => e !== 'skill.tgz' && !e.startsWith('ash-push.'));
    if (entries.length === 1) {
      const only = path.join(tmpDir, entries[0]);
      if (fs.statSync(only).isDirectory()) root = only;
    }

    // 找 SKILL.md（大小写兼容：SKILL.md / skill.md / Skill.md）
    const findSkillMd = (dir) => fs.readdirSync(dir).find((f) => f.toLowerCase() === 'skill.md' && fs.statSync(path.join(dir, f)).isFile());
    let skillMdPath = null;
    const rootHit = findSkillMd(root);
    if (rootHit) {
      skillMdPath = path.join(root, rootHit);
    } else {
      // 容错：一层子目录里的 skill.md（单根目录包装场景）
      for (const e of fs.readdirSync(root)) {
        const sub = path.join(root, e);
        if (fs.statSync(sub).isDirectory()) {
          const hit = findSkillMd(sub);
          if (hit) { skillMdPath = path.join(sub, hit); root = sub; break; }
        }
      }
    }
    if (!skillMdPath) return { error: '归档根目录（或唯一子目录）缺少 SKILL.md——技能必须以 SKILL.md 作为入口文件' };

    const content = fs.readFileSync(skillMdPath, 'utf8');

    // 收集附属文本文件；超限即报错（不静默丢弃）
    const files = [];
    let totalBytes = 0;
    const skipped = [];
    const skippedType = [];
    (function walk(dir, rel) {
      for (const item of fs.readdirSync(dir).sort()) {
        if (item === '.git' || item === 'node_modules' || item === '__pycache__' || item === 'skill.tgz' || item === '.DS_Store' || item.startsWith('._') || item.startsWith('ash-push.')) continue;
        const full = path.join(dir, item);
        const relP = rel ? `${rel}/${item}` : item;
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, relP);
        else if (item.toLowerCase() !== 'skill.md') {
          if (files.length >= MAX_FILES) throw new Error(`附属文件数超过上限 ${MAX_FILES}`);
          if (!extAllowed(item)) { skippedType.push(relP); return; }
          if (stat.size > MAX_FILE) { skipped.push(`${relP} (${Math.round(stat.size / 1024)}KB)`); return; }
          totalBytes += stat.size;
          if (totalBytes > MAX_TOTAL_TEXT) throw new Error(`附属文本总量超过上限 4MB`);
          files.push({ path: relP, content: fs.readFileSync(full, 'utf8') });
        }
      }
    })(root, '');
    return { content, files, skipped, skippedType };
  } catch (e) {
    return { error: e.message };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function shellQuote(p) { return `'${String(p).replace(/'/g, `'\\''`)}'`; }

// Agent 一键 Push 上传端点 (支持 JSON、单文件 FormData、归档 tar.gz 上传)
router.post('/push', upload.single('file'), (req, res) => {
  try {
    let content = '';
    let name = req.body.name;
    let slug = req.body.slug;
    let description = req.body.description;
    let terminalSource = req.body.terminal || req.body.terminal_source || 'Agent-CLI';
    let folderPath = req.body.folder || req.body.folder_path || 'inbox'; // 默认进入 inbox

    let fileFallbackName = '';
    let archiveFiles = [];
    let skippedOversize = [];
    let skippedNonWhitelist = [];
    if (req.file && /\.(tar\.gz|tgz|zip)$/i.test(req.file.originalname)) {
      // 归档上传：解包出 SKILL.md + 附属文件
      const extracted = extractSkillArchive(req.file.buffer);
      if (!extracted || extracted.error) {
        return res.status(400).json({ error: (extracted && extracted.error) || '归档解析失败' });
      }
      content = extracted.content;
      archiveFiles = extracted.files;
      skippedOversize = extracted.skipped || [];
      skippedNonWhitelist = extracted.skippedType || [];
      if (!folderPath || folderPath === 'inbox') {
        // 归档里若有目录名暗示分类，仅作展示参考；仍默认 inbox
      }
    } else if (req.file) {
      content = req.file.buffer.toString('utf8');
      // 文件名（如 SKILL.md）只做兜底，且 SKILL/README 这类通用名不用
      const base = req.file.originalname.replace(/\.md$/i, '').trim();
      if (base && !/^(skill|readme|untitled)$/i.test(base)) fileFallbackName = base;
    } else if (req.body.content) {
      content = req.body.content;
    }

    if (!content) {
      return res.status(400).json({ error: 'Missing skill content or file' });
    }

    const parsed = parseSkillContent(content);
    const securityWarnings = securityScan(content + '\n' + archiveFiles.map((f) => f.content).join('\n'));
    if (skippedNonWhitelist.length) securityWarnings.push(`已跳过非白名单类型文件: ${skippedNonWhitelist.join(', ')}`);
    // 名称优先级：显式传入 > 正文 H1（人话标题）> frontmatter name > 文件名兜底 > slug
    if (!name) {
      const h1 = (content.match(/^#\s+(.+)$/m) || [])[1];
      if (h1) name = h1.trim();
    }
    if (!name && parsed.data.name) name = parsed.data.name;
    if (!description && parsed.data.description) description = parsed.data.description;
    if (!slug && parsed.data.name) slug = parsed.data.name;
    if (!slug && name) slug = name;

    slug = (slug || 'skill-' + Date.now()).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    name = name || fileFallbackName || slug;

    // 检查是否已有同名
    const existing = db.prepare(`SELECT id, folder_path FROM skills WHERE slug = ?`).get(slug);

    if (existing) {
      // agent 推送覆盖前快照旧版本
      try {
        const old = db.prepare('SELECT * FROM skills WHERE id = ?').get(existing.id);
        if (old && old.content !== content) {
          db.prepare('INSERT INTO skill_versions (skill_id, content, files, name, description, source) VALUES (?, ?, ?, ?, ?, ?)')
            .run(old.id, old.content, old.files, old.name, old.description, 'agent');
        }
      } catch (e) { console.error('agent snapshot failed:', e.message); }
      db.prepare(`
        UPDATE skills 
        SET name = ?, description = ?, content = ?, files = ?, terminal_source = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, description || '', content, JSON.stringify(archiveFiles), terminalSource, existing.id);

      saveSkillToDisk(existing.folder_path, slug, content, archiveFiles);
      return res.json({
        success: true,
        action: 'updated',
        slug,
        folder_path: existing.folder_path,
        files: archiveFiles.length,
        skipped_oversize: skippedOversize.length ? skippedOversize : undefined,
        security_warnings: securityWarnings.length ? securityWarnings : undefined,
        warning: [skippedOversize.length ? `已跳过超限文件（>512KB）: ${skippedOversize.join(', ')}` : null, securityWarnings.length ? `⚠️ 安全提醒: ${securityWarnings.join('; ')}` : null].filter(Boolean).join(' | ') || undefined,
        url: `${getBaseUrl(req)}/s/${slug}`
      });
    }

    const stmt = db.prepare(`
      INSERT INTO skills (slug, name, description, folder_path, tags, content, files, terminal_source)
      VALUES (?, ?, ?, ?, '[]', ?, ?, ?)
    `);
    stmt.run(slug, name, description || '', folderPath, content, JSON.stringify(archiveFiles), terminalSource);

    saveSkillToDisk(folderPath, slug, content, archiveFiles);

    res.status(201).json({
      success: true,
      action: 'created',
      slug,
      folder_path: folderPath,
      files: archiveFiles.length,
      skipped_oversize: skippedOversize.length ? skippedOversize : undefined,
      warning: skippedOversize.length ? `已跳过超限文件（>512KB）: ${skippedOversize.join(', ')}` : undefined,
      url: `${getBaseUrl(req)}/s/${slug}`,
      install_cmd: `curl -fsSL ${getBaseUrl(req)}/s/${slug}/install.sh | bash`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
