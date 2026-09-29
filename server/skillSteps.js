// 重复的操作：从技能的 shell 代码块里抽出命令，归一化后找「几个技能里都有的同一段命令」。
// 找的是操作而不是文字：两个技能描述完全不同，却都有 ssh → docker exec → bazel build 这同一串命令，
// 这正是该提炼成元技能（或改为引用已有元技能）的信号。只看 shell 代码块——命令可以可靠地比对，散文步骤不行。
//
// 归一化：去掉提示符与注释、合并续行，引号串 / IP / 路径 / 变量 / 数字换成占位符，保留命令名和参数开关。
// cd、ls、echo 这类不构成操作的命令不参与比对。
const matter = require('gray-matter');

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'shell-session']);
const TRIVIAL = new Set(['cd', 'ls', 'echo', 'pwd', 'export', 'mkdir', 'sleep', 'clear', 'true', 'set', 'source', 'which', 'printf', 'cat', 'exit', 'then', 'fi', 'done', 'do', 'else', 'esac']);
const BOUNDARY = '\u0000';

// 至少这么多条连续相同的命令才算「同一段操作」
const MIN_RUN = 3;

function normalizeToken(token) {
  if (/^(['"]).*\1$/.test(token)) return 'S';
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(token)) return 'IP';
  if (/^[\w.-]+@[\w.-]+(:\S*)?$/.test(token)) return 'U@H';
  if (/^(\$\{?\w+\}?|<[^>]+>|\{\{[^}]+\}\})$/.test(token)) return 'V';
  if (/^-{1,2}[\w-]+=/.test(token)) return `${token.split('=')[0]}=V`;
  if (token.includes('/') && !/^-/.test(token)) return 'P';
  if (/^\d+$/.test(token)) return 'N';
  return token;
}

// 一行 shell → 归一化后的命令；不构成操作的返回 null
function normalizeCommand(line) {
  let s = line.trim().replace(/^\$\s+/, '');
  // 命令以命令名或可执行文件路径开头；以引号、括号、标点开头的是数据或输出
  if (!s || !/^[\w.[/~]/.test(s)) return null;
  s = s.replace(/\s+#\s.*$/, '');
  // 引号串先整体替换，免得里面的空格把它拆开
  s = s.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, 'S');
  const tokens = s.split(/\s+/).filter(Boolean);
  while (tokens.length && /^(sudo|time|env|\w+=\S*)$/.test(tokens[0])) tokens.shift();
  if (!tokens.length || TRIVIAL.has(tokens[0])) return null;
  return tokens.map(normalizeToken).join(' ');
}

// 技能 → [{ normalized, raw }]，代码块之间插入边界，比对时不跨块
function extractCommands(content) {
  let body = String(content || '');
  try { body = matter(body, {}).content; } catch { /* frontmatter 坏了就整段当正文 */ }
  const commands = [];
  for (const match of body.matchAll(/^(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)^\1[^\n]*$/gm)) {
    if (!SHELL_LANGS.has(match[2].toLowerCase())) continue;
    const lines = match[3].replace(/\\\n\s*/g, ' ').split('\n');
    let added = false;
    let heredocEnd = null;
    for (const line of lines) {
      // heredoc 的内容是数据（JSON、配置、脚本正文），不是要比对的命令
      if (heredocEnd) { if (line.trim() === heredocEnd) heredocEnd = null; continue; }
      const heredoc = /<<-?\s*(['"]?)(\w+)\1/.exec(line);
      if (heredoc) heredocEnd = heredoc[2];
      const normalized = normalizeCommand(line);
      if (normalized) { commands.push({ normalized, raw: line.trim().replace(/^\$\s+/, '') }); added = true; }
    }
    if (added) commands.push({ normalized: BOUNDARY, raw: '' });
  }
  return commands;
}

// 多个技能之间共有的命令段。skills: [{ id, commands }]
// 返回 [{ skills: [id…], commands: [原始命令行…] }]，按涉及的技能数、命令段长度降序
function sharedRuns(skills) {
  const shingles = new Map();
  for (const skill of skills) {
    const c = skill.commands;
    for (let i = 0; i + MIN_RUN <= c.length; i += 1) {
      const window = c.slice(i, i + MIN_RUN);
      if (window.some((x) => x.normalized === BOUNDARY)) continue;
      const key = window.map((x) => x.normalized).join('\n');
      if (!shingles.has(key)) shingles.set(key, new Map());
      const positions = shingles.get(key);
      if (!positions.has(skill.id)) positions.set(skill.id, i);
    }
  }
  // 同一组技能共有的若干窗口合并成连续的段，取最长的一段展示。一个窗口若被更多技能共有（{a,b,c}），
  // 它同样属于其中任意两个（{a,b}）：a、b 共有 4 条而 c 只有其中 3 条时，{a,b} 这一组要能看到完整的 4 条
  const shared = [...shingles.values()].filter((positions) => positions.size >= 2);
  const groups = new Map();
  for (const positions of shared) {
    const ids = [...positions.keys()].sort((a, b) => a - b);
    const key = ids.join(',');
    if (!groups.has(key)) groups.set(key, { ids, starts: [] });
  }
  for (const group of groups.values()) {
    for (const positions of shared) {
      if (group.ids.every((id) => positions.has(id))) group.starts.push(positions.get(group.ids[0]));
    }
  }
  const byId = new Map(skills.map((s) => [s.id, s]));
  const results = [];
  for (const { ids, starts } of groups.values()) {
    const sorted = [...new Set(starts)].sort((a, b) => a - b);
    let best = null;
    let run = { from: sorted[0], to: sorted[0] + MIN_RUN };
    for (const start of sorted.slice(1)) {
      if (start <= run.to) run.to = Math.max(run.to, start + MIN_RUN);
      else { if (!best || run.to - run.from > best.to - best.from) best = run; run = { from: start, to: start + MIN_RUN }; }
    }
    if (!best || run.to - run.from > best.to - best.from) best = run;
    const commands = byId.get(ids[0]).commands.slice(best.from, best.to).map((x) => x.raw);
    results.push({ skills: ids, commands });
  }
  // 一段命令同时出现在 {a,b,c} 和 {a,b} 里时，只保留更大的组
  const kept = results.filter((r) => !results.some((o) => o !== r && o.skills.length > r.skills.length
    && r.skills.every((id) => o.skills.includes(id)) && o.commands.length >= r.commands.length));
  return kept.sort((a, b) => b.skills.length - a.skills.length || b.commands.length - a.commands.length);
}

module.exports = { extractCommands, normalizeCommand, sharedRuns, MIN_RUN };
