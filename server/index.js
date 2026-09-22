const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const { saveSkillToDisk } = require('./storage');
const skillsRoutes = require('./routes/skills');
const foldersRoutes = require('./routes/folders');
const agentRoutes = require('./routes/agent');

const app = express();
const PORT = process.env.PORT || 9444;

app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// 初始化种子数据
function initSeedData() {
  const skillCount = db.prepare(`SELECT COUNT(*) as count FROM skills`).get().count;
  if (skillCount > 0) return;

  console.log('🌱 初始化种子数据与默认文件夹...');

  const insertFolder = db.prepare(`INSERT OR IGNORE INTO folders (path, name, parent_path) VALUES (?, ?, ?)`);
  insertFolder.run('inbox', '收件箱 (Inbox)', '');
  insertFolder.run('ADL4', 'ADL4 自动驾驶', '');
  insertFolder.run('ADL4/Worldsim', 'Worldsim 仿真', 'ADL4');
  insertFolder.run('ADL4/Planning', 'Planning 规划', 'ADL4');
  insertFolder.run('ADL4/Control', 'Control 控制', 'ADL4');
  insertFolder.run('DevOps', 'DevOps & 部署', '');

  const insertSkill = db.prepare(`
    INSERT INTO skills (slug, name, description, folder_path, tags, content, terminal_source, is_starred, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seeds = [
    {
      slug: 'voyager-worldsim',
      name: 'Voyager Worldsim 仿真调试',
      description: '嬴彻科技 Voyager 平台十字路口左右转及高速仿真运行与自验规范',
      folder_path: 'inbox', // 故意留在 inbox 供用户体验归档
      tags: JSON.stringify(['voyager', 'simulation', 'worldsim', 'planning']),
      terminal_source: 'Mac-Hermes',
      is_starred: 1,
      version: '1.2.0',
      content: `---
name: voyager-worldsim
description: 嬴彻科技 Voyager 平台十字路口左右转及高速仿真运行与自验规范
tags: [voyager, simulation, worldsim, planning]
version: 1.2.0
---

# Voyager Worldsim 仿真调试指南

## 核心说明
本技能用于在开发或仿真机（如 4090）上跑通 Voyager worldsim 最小集闭环。

### 1. 常用启动命令
\`\`\`bash
# 最小集仿真启动
./scripts/run_worldsim_minimal.sh --scenario junction_turn_left --map sh_lingang_hdmap

# 启动 Web 监控控制台
./scripts/launch_console.sh --port 8080
\`\`\`

### 2. 关键自验标准
- [ ] 车辆在十字路口停止线前正确感知红绿灯状态
- [ ] 左转曲率规划平滑，无大曲率急打方向
- [ ] 挂车铰接角在安全限值内（< 42度）
`
    },
    {
      slug: 'stpc-planning-migrate',
      name: 'STPC Planning 迁移与适配',
      description: '将 stpc_planning 算法适配至 Voyager 双 ThorX 架构指南',
      folder_path: 'ADL4/Planning',
      tags: JSON.stringify(['planning', 'stpc', 'thorx']),
      terminal_source: 'ThinkPad-ADU',
      is_starred: 0,
      version: '1.0.1',
      content: `---
name: stpc-planning-migrate
description: 将 stpc_planning 算法适配至 Voyager 双 ThorX 架构指南
tags: [planning, stpc, thorx]
version: 1.0.1
---

# STPC Planning 迁移与适配指南

## 架构要点
- 双 ThorX 架构下，STPC 作为主规划器运行在 ADU Thor A
- 通过共享内存接收 Perception 输出的目标列表与预测轨迹
`
    },
    {
      slug: 'internal-service-deploy',
      name: '内网服务公网穿透与部署',
      description: '基于 seed-SER9 和反向 SSH 隧道快速发布 HTTPS 公网服务',
      folder_path: 'DevOps',
      tags: JSON.stringify(['devops', 'tunnel', 'nginx', 'ssh']),
      terminal_source: 'Mac-Hermes',
      is_starred: 1,
      version: '2.0.0',
      content: `---
name: internal-service-deploy
description: 基于 seed-SER9 和反向 SSH 隧道快速发布 HTTPS 公网服务
tags: [devops, tunnel, nginx, ssh]
version: 2.0.0
---

# 内网服务公网穿透与部署

## 拓扑
\`seed-SER9 (内网)\` --SSH Tunnel--> \`公网网关 (117.72.155.136)\` --Nginx HTTPS--> \`709970.xyz\`
`
    },
    {
      slug: 'ego-browser',
      name: 'ego-browser 浏览器自动化与评测',
      description: '基于 Chromium 的 Agent 自动化浏览器，支持页面截图、DOM Snapshot、交互操作与全流程 Web QA',
      folder_path: 'inbox',
      tags: JSON.stringify(['browser', 'automation', 'qa', 'testing']),
      terminal_source: 'Mac-Hermes',
      is_starred: 1,
      version: '2.0.0',
      content: `# ego-browser\n\n支持通过 Chromium 进行自动化浏览、点击、输入、截图与状态验证。`
    },
    {
      slug: 'systematic-debugging',
      name: 'Systematic Debugging 4步根因排查法',
      description: '4-phase root cause debugging: understand bugs before fixing.',
      folder_path: 'inbox',
      tags: JSON.stringify(['debug', 'root-cause', 'engineering']),
      terminal_source: 'Mac-Hermes',
      is_starred: 1,
      version: '1.0.0',
      content: `# Systematic Debugging\n\n4-phase root cause debugging: understand bugs before fixing.`
    },
    {
      slug: 'inceptio-work-ops',
      name: 'Inceptio 飞书任务与工作流流转',
      description: '飞书任务状态同步、Meegle 看板跟踪与跨终端交接规范',
      folder_path: 'inbox', // 放在收件箱
      tags: JSON.stringify(['feishu', 'meegle', 'workflow']),
      terminal_source: 'Web',
      is_starred: 0,
      version: '1.1.0',
      content: `---
name: inceptio-work-ops
description: 飞书任务状态同步、Meegle 看板跟踪与跨终端交接规范
tags: [feishu, meegle, workflow]
version: 1.1.0
---

# Inceptio 研发工作流规范

## 核心原则
- 任务状态以 Meegle 实时查询为准，不以历史记忆代替。
- 跨机交接必须在飞书消息中写清：输入、输出、验收标准和结果位置。
`
    }
  ];

  seeds.forEach(s => {
    insertSkill.run(s.slug, s.name, s.description, s.folder_path, s.tags, s.content, s.terminal_source, s.is_starred, s.version);
    saveSkillToDisk(s.folder_path, s.slug, s.content, []);
  });

  console.log('✅ 种子数据填充完成！');
}

initSeedData();

// 挂载 API
app.use('/api/skills', skillsRoutes);
app.use('/api/folders', foldersRoutes);
app.use('/s', agentRoutes);
app.use('/api/agent', agentRoutes);

// CLI 快速安装脚本与万能初始化命令 (/setup.sh 或 /cli.sh)
app.get(['/setup.sh', '/cli.sh'], (req, res) => {
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const serverUrl = `${proto}://${host}`;

  const cliScript = `#!/bin/bash
# AnotherSkillHub Unified Agent CLI & Setup Script
set -e
set -o pipefail

SERVER_URL="${serverUrl}"

# 仅当通过 curl|bash 管道执行（$0 为 bash/sh）或显式传 install 参数时才走安装分支；
# 已安装后的裸调用（ash 无参数）直接显示帮助，不再触发重装
if [ "$0" = "bash" ] || [ "$0" = "sh" ] || [ "$1" = "install" ]; then
    echo "========================================================="
    echo "  🚀 正在为当前系统/Agent 安装 AnotherSkillHub 命令行工具..."
    echo "========================================================="

    TARGET_BIN="/usr/local/bin/ash"
    USE_SUDO=""
    if [ ! -w "/usr/local/bin" ]; then
        if command -v sudo >/dev/null 2>&1; then
            USE_SUDO="sudo"
        else
            mkdir -p "\$HOME/.local/bin"
            TARGET_BIN="\$HOME/.local/bin/ash"
        fi
    fi

    echo "正在写入全局命令到: \$TARGET_BIN"
    TMP_FILE=\$(mktemp /tmp/ash.XXXXXX)
    curl -fsSL "\$SERVER_URL/cli.sh" -o "\$TMP_FILE"
    chmod +x "\$TMP_FILE"

    if [ -n "\$USE_SUDO" ]; then
        sudo mv "\$TMP_FILE" "\$TARGET_BIN"
    else
        mv "\$TMP_FILE" "\$TARGET_BIN"
    fi

    echo "========================================================="
    echo "✅ AnotherSkillHub 安装就绪！终端与 Agent 已可全局调度。"
    echo "========================================================="
    echo "常用指令:"
    echo "  ash pull <slug>       # 一键拉取并安装技能包"
    echo "  ash push <dir/file>   # 将本地技能推送到云端收件箱"
    echo "  ash list              # 列出云端全部技能"
    echo "  ash search <kw>       # 终端搜索技能"
    echo "  ash open              # 在浏览器中打开管理后台"
    echo "========================================================="
    exit 0
fi

show_help() {
  echo "AnotherSkillHub CLI 客户端"
  echo "服务地址: $SERVER_URL"
  echo ""
  echo "使用方法:"
  echo "  ash pull <slug>       下载并安装指定技能"
  echo "  ash push <file/dir>   推送本地技能到 AnotherSkillHub 收件箱"
  echo "  ash list              查看云端全部技能"
  echo "  ash search <keyword>  快速搜索技能"
  echo "  ash open              在浏览器中打开 AnotherSkillHub"
}

if [ "$1" = "pull" ]; then
  if [ -z "$2" ]; then
    echo "错误: 请提供技能代号 (slug)"
    exit 1
  fi
  curl -fsSL "$SERVER_URL/s/$2/install.sh" | bash
elif [ "$1" = "list" ]; then
  echo "正在获取云端技能列表..."
  curl -fsSL "$SERVER_URL/api/skills"
elif [ "$1" = "search" ]; then
  if [ -z "$2" ]; then
    echo "错误: 请提供搜索关键词"
    exit 1
  fi
  curl -fsSL "$SERVER_URL/api/skills?search=$2"
elif [ "$1" = "push" ]; then
  TARGET="$2"
  if [ -z "\$TARGET" ]; then
    TARGET="./SKILL.md"
  fi
  TERMINAL_NAME="\$(hostname 2>/dev/null || echo 'Unknown-Host')"
  if [ -d "\$TARGET" ]; then
    # 目录模式：整目录打包上传（含 SKILL.md + references/ + scripts/ 等附属资源）
    if [ ! -f "\$TARGET/SKILL.md" ]; then
      echo "错误: 目录中缺少 SKILL.md：\$TARGET"
      exit 1
    fi
    ARCHIVE="\$(mktemp /tmp/ash-push.XXXXXX).tar.gz"
    COPYFILE_DISABLE=1 tar -czf "\$ARCHIVE" --exclude='.DS_Store' --exclude='._*' -C "\$TARGET" .
    NFILES=\$(tar -tzf "\$ARCHIVE" | grep -vc '/$' | tr -d ' ')
    echo "正在向 AnotherSkillHub 推送目录: \$TARGET (\${NFILES} 个文件, 来源: \${TERMINAL_NAME})..."
    RESP=\$(curl -fsSL -X POST "$SERVER_URL/api/agent/push" -F "file=@\${ARCHIVE};type=application/gzip" -F "terminal=\${TERMINAL_NAME}")
    rm -f "\$ARCHIVE"
    echo "\$RESP"
    echo ""
    if echo "\$RESP" | grep -q '"warning"'; then
      echo "⚠️  \$(echo "\$RESP" | grep -o '"warning":"[^"]*"' | cut -d'"' -f4)"
    fi
    echo "✅ 完整技能包（含附属文件）已推送并存入 AnotherSkillHub 收件箱 (Inbox)！"
  else
    FILE="\$TARGET"
    if [ ! -f "\$FILE" ]; then
      echo "错误: 找不到技能文件 \$FILE"
      exit 1
    fi
    echo "正在向 AnotherSkillHub 推送: \$FILE (来源: \${TERMINAL_NAME})..."
    curl -fsSL -X POST "$SERVER_URL/api/agent/push" -F "file=@\${FILE}" -F "terminal=\${TERMINAL_NAME}"
    echo ""
    echo "✅ 技能已推送并存入 AnotherSkillHub 收件箱 (Inbox)！"
  fi
elif [ "$1" = "open" ]; then
  if command -v open >/dev/null 2>&1; then
    open "$SERVER_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$SERVER_URL"
  else
    echo "请在浏览器打开: $SERVER_URL"
  fi
else
  show_help
fi
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(cliScript);
});

// 前端静态文件托管（打包后的 SPA）
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res) => {
    // 忽略 API 请求
    if (req.path.startsWith('/api') || req.path.startsWith('/s/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('<h1>AnotherSkillHub API Server is running</h1><p>Client UI is building...</p>');
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AnotherSkillHub Server listening on http://0.0.0.0:${PORT}`);
});
