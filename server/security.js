// 推送内容的轻量安全扫描：命中只提示不阻塞；high 级命中会强制进入人工审核。
// 注意：正则不能带 g 标志——模块级正则反复 .test() 会残留 lastIndex，导致间歇性漏报。
const SECURITY_PATTERNS = [
  { re: /rm\s+-rf\s+(?:--no-preserve-root\s+)?(?:\/|~|\$HOME)(?:\s|\/?\*?\s*$)/m, msg: '包含 rm -rf 指向根/家目录的危险写法', level: 'high' },
  { re: /curl[^|;\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/, msg: '包含 curl|sh 远程执行（若非自有服务安装脚本请人工确认）', level: 'medium' },
  { re: /wget[^|;\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/, msg: '包含 wget|sh 远程执行', level: 'medium' },
  { re: /(?:eval|exec)\s*\(.{0,40}(?:base64|\\x)/i, msg: '包含 base64/十六进制混淆的 eval/exec', level: 'high' },
  { re: /(?:aws_secret_access_key|api[_-]?key|private[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9+/_-]{16,}/i, msg: '疑似硬编码密钥', level: 'medium' },
  { re: /\bnc\s+-e\b|reverse[_-]?shell|bash\s+-i\s+>&\s*\/dev\/tcp/i, msg: '疑似反弹 shell', level: 'high' },
];

function securityScan(text) {
  return SECURITY_PATTERNS.filter((p) => p.re.test(text)).map(({ msg, level }) => ({ msg, level }));
}

function scanSkill(content, files = []) {
  return securityScan([content || '', ...files.map((f) => f.content || '')].join('\n'));
}

const hasHighRisk = (warnings) => warnings.some((w) => w.level === 'high');

module.exports = { securityScan, scanSkill, hasHighRisk };
