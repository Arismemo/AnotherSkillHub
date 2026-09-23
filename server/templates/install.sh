#!/usr/bin/env bash
# AnotherSkillHub 技能安装脚本（由服务端生成，所有变量均为单引号字面量）
set -euo pipefail

SKILL_NAME=__SLUG__
BASE_URL=__BASE_URL__
AGENT_TARGET=__AGENT__
CUSTOM_DIR=__DIR__
PENDING=__PENDING__
FORCE=__FORCE__
NODEPS=__NODEPS__
REVISION=__REVISION__
VERSION=__VERSION__
DEPS=(__DEPS__)

echo "📦 AnotherSkillHub: 正在安装技能 [$SKILL_NAME]"

# 自动探测：ASH_SKILLS_DIR > 唯一的 hermes profile > 已存在的常见目录 > ~/.agents/skills
detect_root() {
  if [ -n "${ASH_SKILLS_DIR:-}" ]; then echo "$ASH_SKILLS_DIR"; return; fi
  if [ -d "$HOME/.hermes/profiles" ]; then
    set -- "$HOME"/.hermes/profiles/*/skills
    if [ "$#" -eq 1 ] && [ -d "$1" ]; then echo "$1"; return; fi
  fi
  for d in "$HOME/.hermes/skills" "$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.dsh/skills"; do
    if [ -d "$d" ]; then echo "$d"; return; fi
  done
  echo "$HOME/.agents/skills"
}

# 技能目录内容指纹（不含 .ash）：判断本地是否改过。与 ash CLI 中的定义保持一致
ash_fingerprint() {
  (cd "$1" && find . -type f ! -name .ash -print | LC_ALL=C sort | while IFS= read -r f; do printf '%s\n' "$f"; cat "$f"; done) | cksum | awk '{print $1 "-" $2}'
}

case "$AGENT_TARGET" in
  hermes) SKILLS_ROOT="$HOME/.hermes/skills" ;;
  codex)  SKILLS_ROOT="$HOME/.agents/skills" ;;
  claude) SKILLS_ROOT="$HOME/.claude/skills" ;;
  dsh)    SKILLS_ROOT="$HOME/.dsh/skills" ;;
  *)      SKILLS_ROOT="$(detect_root)" ;;
esac

case "$CUSTOM_DIR" in
  "~") CUSTOM_DIR="$HOME" ;;
  "~/"*) CUSTOM_DIR="$HOME/${CUSTOM_DIR#\~/}" ;;
esac
if [ -n "$CUSTOM_DIR" ]; then SKILLS_ROOT="$CUSTOM_DIR"; fi
INSTALL_DIR="$SKILLS_ROOT/$SKILL_NAME"
mkdir -p "$SKILLS_ROOT"
echo "目标安装目录: $INSTALL_DIR"

# 先解压到同级的隐藏临时目录，成功后整体替换：旧版本里已删除的文件不会残留
STAGING="$(mktemp -d "$SKILLS_ROOT/.ash-staging.XXXXXX")"
TMP_ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/ash-pull.XXXXXX")"
trap 'rm -rf "$STAGING" "$TMP_ARCHIVE"' EXIT
# 归档顶层带 <slug>/ 目录，--strip-components=1 去掉
if curl -fsSL "$BASE_URL/s/$SKILL_NAME/archive.tar.gz?pending=$PENDING" -o "$TMP_ARCHIVE"; then
  tar -xzf "$TMP_ARCHIVE" -C "$STAGING" --strip-components=1
  echo "✓ 完整技能包下载成功"
else
  echo "⚠️  完整技能包下载失败，改为只拉取 SKILL.md" >&2
  curl -fsSL "$BASE_URL/s/$SKILL_NAME.md?raw=1&pending=$PENDING" -o "$STAGING/SKILL.md"
fi
rm -f "$STAGING/.ash"
if [ -d "$STAGING/scripts" ]; then
  chmod +x "$STAGING/scripts"/* 2>/dev/null || true
fi

# 覆盖前保护：本地改过的、或不是 ash 安装的同名目录先备份到 ~/.ash/backups（--force 跳过备份）
if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  reason=""
  if [ -f "$INSTALL_DIR/.ash" ]; then
    recorded="$(sed -n 's/^fingerprint=//p' "$INSTALL_DIR/.ash")"
    if [ "$recorded" != "$(ash_fingerprint "$INSTALL_DIR")" ]; then reason="本地有修改"; fi
  else
    reason="不是由 ash 安装的"
  fi
  if [ -n "$reason" ] && [ "$FORCE" != "1" ]; then
    BACKUP="$HOME/.ash/backups/$SKILL_NAME-$(date +%Y%m%d%H%M%S)"
    mkdir -p "$(dirname "$BACKUP")"
    mv "$INSTALL_DIR" "$BACKUP"
    echo "⚠️  原目录${reason}，已备份到 $BACKUP" >&2
  fi
fi
rm -rf "$INSTALL_DIR"
mv "$STAGING" "$INSTALL_DIR"

{
  printf 'slug=%s\n' "$SKILL_NAME"
  printf 'server=%s\n' "$BASE_URL"
  printf 'revision=%s\n' "$REVISION"
  printf 'version=%s\n' "$VERSION"
  printf 'pending=%s\n' "$PENDING"
  printf 'fingerprint=%s\n' "$(ash_fingerprint "$INSTALL_DIR")"
  printf 'installed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$INSTALL_DIR/.ash"

echo "✅ 技能 [$SKILL_NAME] v$VERSION 已安装到 $INSTALL_DIR"

# 依赖：装到同一目录；已安装的不动；ASH_DEPS_SEEN 防止循环依赖
if [ "$NODEPS" != "1" ] && [ "${#DEPS[@]}" -gt 0 ]; then
  export ASH_DEPS_SEEN="${ASH_DEPS_SEEN:-},$SKILL_NAME,"
  for dep in "${DEPS[@]}"; do
    case "$ASH_DEPS_SEEN" in *",$dep,"*) continue ;; esac
    if [ -f "$SKILLS_ROOT/$dep/.ash" ]; then
      echo "↳ 依赖 $dep 已安装，跳过"
      continue
    fi
    echo "↳ 安装依赖 $dep"
    if ! dep_script="$(curl -fsS "$BASE_URL/s/$dep/install.sh")" || ! printf '%s\n' "$dep_script" | ASH_SKILLS_DIR="$SKILLS_ROOT" bash; then
      echo "⚠️  依赖 $dep 安装失败（不存在、未发布或网络错误），请手动处理" >&2
    fi
  done
fi

echo "   下一步：阅读 $INSTALL_DIR/SKILL.md 并按其步骤执行"
