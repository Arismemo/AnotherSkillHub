// 审核与发布：Agent 推送的新技能（status=pending）和对已发布技能的更新（pending_*）都要人工采纳后
// 才对 /s/ 可见。ASH_REQUIRE_REVIEW=0 可关闭审核，但命中高危安全模式的推送仍强制待审。
const crypto = require('crypto');
const db = require('./db');
const { replaceSkillOnDisk } = require('./storage');
const { scanSkill } = require('./security');

const reviewRequired = () => process.env.ASH_REQUIRE_REVIEW !== '0';

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function snapshotSkillVersion(skill, source) {
  try {
    db.prepare('INSERT INTO skill_versions (skill_id, content, files, name, description, source) VALUES (?, ?, ?, ?, ?, ?)')
      .run(skill.id, skill.content, skill.files, skill.name, skill.description, source || 'web');
  } catch (e) {
    console.error('snapshot failed:', e.message);
  }
}

// 已发布内容的修订号：安装时记入本地 .ash，ash installed 据此判断是否有更新
function skillRevision(skill) {
  return crypto.createHash('sha256').update(`${skill.content}\0${skill.files || '[]'}`).digest('hex').slice(0, 12);
}

function recordReview(skillId, action, kind, source) {
  db.prepare("UPDATE skills SET last_review = ? WHERE id = ?")
    .run(JSON.stringify({ action, kind, source: source || null, at: new Date().toISOString() }), skillId);
}

// Agent 拉取可见：未删除且已发布；显式 pending=1 时允许待审核的新技能（推送者自用）
function isVisibleToAgents(skill, { allowPending = false } = {}) {
  if (!skill || skill.is_deleted) return false;
  return skill.status !== 'pending' || allowPending;
}

// 采纳：新技能 → 发布；待审更新 → 快照旧版后替换内容与附属文件（名称/标签/目录保持人工维护的值）
function approveSkill(skill) {
  if (skill.pending_content !== null && skill.pending_content !== undefined) {
    const meta = parseJson(skill.pending_meta, {});
    const files = parseJson(skill.pending_files, []);
    snapshotSkillVersion(skill, 'agent');
    db.prepare(`
      UPDATE skills SET content = ?, files = ?, description = ?, version = ?, terminal_source = ?, security_warnings = ?,
        status = 'approved', pending_content = NULL, pending_files = NULL, pending_meta = NULL, pending_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(skill.pending_content, JSON.stringify(files), meta.description || skill.description, meta.version || skill.version,
      meta.terminal_source || skill.terminal_source, JSON.stringify(meta.security_warnings || []), skill.id);
    replaceSkillOnDisk(skill.folder_path, skill.slug, skill.pending_content, files);
    recordReview(skill.id, 'approved', 'update', meta.terminal_source);
    return 'update-approved';
  }
  db.prepare("UPDATE skills SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(skill.id);
  recordReview(skill.id, 'approved', 'new', skill.terminal_source);
  return 'approved';
}

// 拒绝：待审更新 → 丢弃；待审新技能 → 移入废纸篓（可恢复）
function rejectSkill(skill) {
  if (skill.pending_content !== null && skill.pending_content !== undefined) {
    const meta = parseJson(skill.pending_meta, {});
    db.prepare('UPDATE skills SET pending_content = NULL, pending_files = NULL, pending_meta = NULL, pending_at = NULL WHERE id = ?').run(skill.id);
    recordReview(skill.id, 'rejected', 'update', meta.terminal_source);
    return 'update-rejected';
  }
  if (skill.status === 'pending') {
    db.prepare('UPDATE skills SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(skill.id);
    recordReview(skill.id, 'rejected', 'new', skill.terminal_source);
    return 'trashed';
  }
  return 'noop';
}

function warningsFor(content, files) {
  return scanSkill(content, files);
}

module.exports = { reviewRequired, parseJson, snapshotSkillVersion, isVisibleToAgents, approveSkill, rejectSkill, warningsFor, skillRevision };
