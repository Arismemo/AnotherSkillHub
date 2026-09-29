// 生成 bash 脚本时的转义工具：任何来自请求或数据库的值都只能以单引号字面量进入脚本。
function shQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

// 请求头拼出来的服务地址也可能被伪造，只允许普通 URL 字符
function getBaseUrl(req) {
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const safeHost = /^[A-Za-z0-9.:[\]-]+$/.test(host) ? host : 'localhost';
  const safeProto = proto === 'https' ? 'https' : 'http';
  return `${safeProto}://${safeHost}`;
}

// 给人/Agent 看的一键安装命令：token 取自环境变量 ASH_TOKEN，否则取 ash login 写入的 ~/.ash/token
const AUTH_CURL_HEADER = '-H "Authorization: Bearer ${ASH_TOKEN:-$(cat ~/.ash/token)}"';
function curlPipeCommand(url) {
  return `curl -fsSL ${AUTH_CURL_HEADER} ${url} | bash`;
}

// 生成的脚本里再发请求时用：运行时读取 token 并导出，交给子脚本继续使用（不写进脚本本身）
const SCRIPT_TOKEN_PRELUDE = [
  'ASH_TOKEN="${ASH_TOKEN:-$(cat "$HOME/.ash/token" 2>/dev/null || true)}"',
  'export ASH_TOKEN',
].join('\n');

// 本机各个 Agent 各自从哪里加载技能（按 Agent 的主目录是否存在判断装没装这个 Agent）：
//   Claude Code  ~/.claude/skills          Codex  ~/.agents/skills（官方的用户级目录）
//   Hermes       唯一的 ~/.hermes/profiles/*/skills，否则 ~/.hermes/skills
//   dsh          ~/.dsh/skills
// 生成的多 Agent 安装脚本与 ash CLI 共用这一份定义
const AGENT_ROOTS_FN = `agent_roots() {
  if [ -d "$HOME/.claude" ]; then echo "$HOME/.claude/skills"; fi
  if [ -d "$HOME/.codex" ] || [ -d "$HOME/.agents" ]; then echo "$HOME/.agents/skills"; fi
  if [ -d "$HOME/.hermes" ]; then
    set -- "$HOME"/.hermes/profiles/*/skills
    if [ "$#" -eq 1 ] && [ -d "$1" ]; then echo "$1"; else echo "$HOME/.hermes/skills"; fi
  fi
  if [ -d "$HOME/.dsh" ]; then echo "$HOME/.dsh/skills"; fi
}`;

module.exports = { shQuote, getBaseUrl, curlPipeCommand, SCRIPT_TOKEN_PRELUDE, AGENT_ROOTS_FN };
