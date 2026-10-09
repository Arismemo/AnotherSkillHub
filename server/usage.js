// 使用记录与健康信号：技能被谁装了、读了、用得怎么样。
// 技能装到本地后由 Agent 框架直接读取，服务端看不到「使用」本身，所以靠两种信号：
//   · 安装 / 阅读（ash pull、ash show）——服务端自己记
//   · 反馈（ash feedback <slug> ok|fail）——安装时在 SKILL.md 末尾附一行提示，请 Agent 用完回报
// 健康信号只从这些事实推出：当前版本常失败、从未使用、长期未用、与别的技能疑似重复；
// 另加技能之间的结构信号（skillRefs）：引用失效、抄了元技能步骤、可提炼元技能、元技能缺契约。
const db = require('./db');
const { skillRevision } = require('./review');
const { duplicateMap } = require('./skillIndex');
const { libraryAnalysis, structuralFlags } = require('./skillRefs');

// use：本机 Agent 真正用到了已装技能（Claude Code 的 Stop hook 从会话记录里认出来，见 ash hooks install）
const EVENT_KINDS = ['install', 'dependency', 'update', 'view', 'use', 'feedback'];
// 「使用」：主动安装、作为依赖安装、阅读、本地调用、反馈。update 是 ash pull --all 顺手刷新，不代表用过
const USE_KINDS = "('install', 'dependency', 'view', 'use', 'feedback')";

const UNUSED_AFTER_DAYS = 14;
const STALE_AFTER_DAYS = 60;
const FAILING_MIN = 2;

function recordEvent(skill, actorId, kind, { outcome = null, note = null, terminal = null, revision = null } = {}) {
  if (!skill || !EVENT_KINDS.includes(kind)) return false;
  try {
    db.prepare('INSERT INTO skill_events (skill_id, actor_id, kind, outcome, note, terminal, revision) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(skill.id, actorId || null, kind, outcome, note, terminal ? String(terminal).slice(0, 120) : null, revision || skillRevision(skill));
    return true;
  } catch (e) {
    // 记录失败不能影响安装与阅读本身
    console.error('recordEvent failed:', e.message);
    return false;
  }
}

const trackingSince = () => db.prepare("SELECT value FROM app_meta WHERE key = 'usage_tracking_since'").get()?.value || '1970-01-01 00:00:00';

// 单个技能的使用概况（详情页、ash info）
function usageSummary(skill) {
  const revision = skillRevision(skill);
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(kind IN ('install', 'dependency') AND created_at >= datetime('now', '-30 days')), 0) AS installs_30d,
      COALESCE(SUM(kind IN ('install', 'dependency')), 0) AS installs,
      COALESCE(SUM(kind = 'view' AND created_at >= datetime('now', '-30 days')), 0) AS views_30d,
      COALESCE(SUM(kind = 'use' AND created_at >= datetime('now', '-30 days')), 0) AS uses_30d,
      COALESCE(SUM(kind = 'feedback' AND outcome = 'ok'), 0) AS ok,
      COALESCE(SUM(kind = 'feedback' AND outcome = 'fail'), 0) AS fail,
      COALESCE(SUM(kind = 'feedback' AND outcome = 'ok' AND revision = @revision), 0) AS ok_current,
      COALESCE(SUM(kind = 'feedback' AND outcome = 'fail' AND revision = @revision), 0) AS fail_current,
      COUNT(DISTINCT CASE WHEN kind IN ('install', 'dependency', 'update') THEN terminal END) AS machines,
      MAX(CASE WHEN kind IN ${USE_KINDS} THEN created_at END) AS last_used_at
    FROM skill_events WHERE skill_id = @id
  `).get({ id: skill.id, revision });
  const recent = db.prepare(`
    SELECT outcome, note, terminal, revision, created_at FROM skill_events
    WHERE skill_id = ? AND kind = 'feedback' ORDER BY created_at DESC, id DESC LIMIT 10
  `).all(skill.id).map((f) => ({ ...f, current: f.revision === revision }));
  return { ...row, revision, recent_feedback: recent, health: healthFlags(skill, row) };
}

function daysSince(timestamp) {
  if (!timestamp) return Infinity;
  return (Date.now() - Date.parse(`${String(timestamp).replace(' ', 'T')}Z`)) / 86400000;
}

// 由使用数据推出的健康信号：[{ code, label, detail }]
function healthFlags(skill, stats, since = trackingSince()) {
  if (!skill || skill.is_deleted || skill.status === 'pending') return [];
  const flags = [];
  const failCurrent = Number(stats.fail_current || 0);
  const okCurrent = Number(stats.ok_current || 0);
  if (failCurrent >= FAILING_MIN && failCurrent >= okCurrent) {
    flags.push({ code: 'failing', label: '常失败', detail: `当前版本 ${failCurrent} 次失败、${okCurrent} 次成功` });
  }
  // 从技能创建或开始记录使用（取较晚者）起算，老技能不会在上线第一天全部变成「从未使用」
  const observedDays = daysSince(String(skill.created_at || '') > since ? skill.created_at : since);
  if (!stats.last_used_at) {
    if (observedDays >= UNUSED_AFTER_DAYS) flags.push({ code: 'unused', label: '从未使用', detail: `${Math.floor(observedDays)} 天内没有安装、阅读、Agent 调用或反馈` });
  } else if (daysSince(stats.last_used_at) >= STALE_AFTER_DAYS) {
    flags.push({ code: 'stale', label: '长期未用', detail: `最近一次使用在 ${String(stats.last_used_at).slice(0, 10)}` });
  }
  return flags;
}

// 整个库的健康信号：Map(skillId → flags)。列表、「需关注」视图、侧栏计数共用
function libraryHealth(userId) {
  const since = trackingSince();
  const skills = db.prepare(`
    SELECT s.id, s.slug, s.content, s.files, s.status, s.is_deleted, s.created_at,
      MAX(CASE WHEN e.kind IN ${USE_KINDS} THEN e.created_at END) AS last_used_at
    FROM skills s LEFT JOIN skill_events e ON e.skill_id = s.id
    WHERE s.user_id = ? AND s.is_deleted = 0 AND s.status != 'pending'
    GROUP BY s.id
  `).all(userId);
  // 修订号在 JS 里算（sha256），反馈先全部取出，再按各技能的当前修订号计数
  const feedback = db.prepare(`
    SELECT e.skill_id, e.outcome, e.revision FROM skill_events e JOIN skills s ON s.id = e.skill_id
    WHERE s.user_id = ? AND s.is_deleted = 0 AND e.kind = 'feedback'
  `).all(userId);
  const bySkill = new Map();
  for (const f of feedback) bySkill.set(f.skill_id, [...(bySkill.get(f.skill_id) || []), f]);
  const duplicates = duplicateMap(userId);
  const structural = structuralFlags(libraryAnalysis(userId));
  const health = new Map();
  for (const skill of skills) {
    const revision = skillRevision(skill);
    const events = bySkill.get(skill.id) || [];
    const stats = {
      ok_current: events.filter((f) => f.outcome === 'ok' && f.revision === revision).length,
      fail_current: events.filter((f) => f.outcome === 'fail' && f.revision === revision).length,
      last_used_at: skill.last_used_at,
    };
    const flags = healthFlags(skill, stats, since);
    const similar = duplicates.get(skill.id);
    if (similar) flags.push({ code: 'duplicate', label: '疑似重复', detail: `与 ${similar.skill.slug} 相似度 ${Math.round(similar.similarity * 100)}%`, slug: similar.skill.slug });
    flags.push(...(structural.get(skill.id) || []));
    if (flags.length) health.set(skill.id, flags);
  }
  return health;
}

// 纯文本一行概况：ash info / ash suggest
function usageLine(summary) {
  const parts = [];
  parts.push(`30 天安装 ${summary.installs_30d} 次`);
  if (summary.machines) parts.push(`装在 ${summary.machines} 台机器上`);
  if (summary.views_30d) parts.push(`阅读 ${summary.views_30d} 次`);
  if (summary.uses_30d) parts.push(`Agent 调用 ${summary.uses_30d} 次`);
  if (summary.ok || summary.fail) {
    const current = summary.ok_current + summary.fail_current;
    parts.push(`反馈 ${summary.ok} 成功 / ${summary.fail} 失败${current !== summary.ok + summary.fail ? `（当前版本 ${summary.ok_current} / ${summary.fail_current}）` : ''}`);
  } else {
    parts.push('暂无反馈');
  }
  return parts.join(' · ');
}

// 反馈率低于它、且用得够多时提示：健康信号（常失败等）多半不准
const LOW_FEEDBACK_RATE = 0.3;
const LOW_FEEDBACK_MIN_USES = 5;

// 整个库的闭环指标（「需关注」视图顶部、ash stats）：最近 N 天技能被拿去用了多少次、其中多少次回报了结果。
// 「用」= 主动安装、阅读、本地调用；作为依赖装上的不算（不是 Agent 选的），update 也不算。
// 反馈率 = 反馈次数 ÷ 使用次数（上限 100%）。按来源机器拆开：哪台机器的 Agent 从不回报、哪台装了 hook，一眼看清
function libraryInsights(userId, { days = 30 } = {}) {
  const n = Math.max(1, Math.min(365, Math.floor(Number(days)) || 30));
  const window = `-${n} days`;
  const rows = db.prepare(`
    SELECT COALESCE(e.terminal, '') AS terminal,
      SUM(e.kind IN ('install', 'view', 'use')) AS uses,
      SUM(e.kind = 'use') AS hook_uses,
      SUM(e.kind = 'feedback') AS feedback,
      SUM(e.kind = 'feedback' AND e.outcome = 'ok') AS ok,
      SUM(e.kind = 'feedback' AND e.outcome = 'fail') AS fail
    FROM skill_events e JOIN skills s ON s.id = e.skill_id
    WHERE s.user_id = ? AND e.created_at >= datetime('now', ?)
    GROUP BY COALESCE(e.terminal, '')
  `).all(userId, window);
  const skills = db.prepare(`
    SELECT COUNT(DISTINCT CASE WHEN e.kind IN ('install', 'view', 'use') THEN e.skill_id END) AS used,
      COUNT(DISTINCT CASE WHEN e.kind = 'feedback' THEN e.skill_id END) AS with_feedback
    FROM skill_events e JOIN skills s ON s.id = e.skill_id
    WHERE s.user_id = ? AND e.created_at >= datetime('now', ?)
  `).get(userId, window);
  const rate = (feedback, uses) => (uses > 0 ? Math.min(1, feedback / uses) : null);
  const sum = (key) => rows.reduce((n, r) => n + Number(r[key] || 0), 0);
  const uses = sum('uses');
  const feedback = sum('feedback');
  const terminals = rows
    .filter((r) => r.uses || r.feedback)
    .map((r) => ({
      terminal: r.terminal || null,
      uses: Number(r.uses || 0),
      feedback: Number(r.feedback || 0),
      feedback_rate: rate(Number(r.feedback || 0), Number(r.uses || 0)),
      hook: Number(r.hook_uses || 0) > 0,
    }))
    .sort((a, b) => b.uses - a.uses);
  const feedbackRate = rate(feedback, uses);
  return {
    days: n,
    uses,
    feedback,
    ok: sum('ok'),
    fail: sum('fail'),
    feedback_rate: feedbackRate,
    skills_used: Number(skills.used || 0),
    skills_with_feedback: Number(skills.with_feedback || 0),
    terminals,
    // 来过、但从没回报过结果的机器：给它们装 hook（ash hooks install）收益最大
    silent_terminals: terminals.filter((t) => t.terminal && t.uses > 0 && t.feedback === 0).map((t) => t.terminal),
    low_feedback: feedbackRate !== null && uses >= LOW_FEEDBACK_MIN_USES && feedbackRate < LOW_FEEDBACK_RATE,
  };
}

const percent = (value) => (value === null ? '—' : `${Math.round(value * 100)}%`);

// 纯文本：ash stats
function insightsText(i) {
  if (!i.uses && !i.feedback) return `近 ${i.days} 天还没有使用记录（安装、阅读、Agent 调用都会被记下）\n`;
  const lines = [
    `近 ${i.days} 天：使用 ${i.uses} 次（${i.skills_used} 个技能）· 反馈 ${i.feedback} 次（${i.ok} 成功 / ${i.fail} 失败）· 反馈率 ${percent(i.feedback_rate)}`,
    '',
    '按机器：',
    ...i.terminals.map((t) => `  ${t.terminal || '（未知来源）'}  ·  使用 ${t.uses}  ·  反馈 ${t.feedback}  ·  反馈率 ${percent(t.feedback_rate)}${t.hook ? '  ·  有 Agent 调用记录' : ''}`),
  ];
  if (i.low_feedback) {
    lines.push('', `⚠️  反馈率低于 ${percent(LOW_FEEDBACK_RATE)}：「常失败」等健康信号可能不准。`
      + '在跑 Claude Code 的机器上运行 ash hooks install，会话结束时自动提醒 Agent 回报用过的技能');
  } else if (i.silent_terminals.length) {
    lines.push('', `ℹ️  这些机器用过技能但从没回报：${i.silent_terminals.join('、')}（在上面运行 ash hooks install）`);
  }
  return `${lines.join('\n')}\n`;
}

const OUTCOMES = { ok: 'ok', success: 'ok', good: 'ok', pass: 'ok', fail: 'fail', failure: 'fail', bad: 'fail', error: 'fail' };
const normalizeOutcome = (value) => OUTCOMES[String(value || '').trim().toLowerCase()] || null;

module.exports = { recordEvent, usageSummary, libraryHealth, libraryInsights, insightsText, usageLine, normalizeOutcome };
