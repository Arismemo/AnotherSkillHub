#!/usr/bin/env bash
# AnotherSkillHub 技能安装脚本（由服务端生成，所有变量均为单引号字面量）
set -euo pipefail

SKILL_NAME=__SLUG__
BASE_URL=__BASE_URL__
AGENT_TARGET=__AGENT__
CUSTOM_DIR=__DIR__
PENDING=__PENDING__

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
if [ -n "$CUSTOM_DIR" ]; then
  INSTALL_DIR="$CUSTOM_DIR/$SKILL_NAME"
else
  INSTALL_DIR="$SKILLS_ROOT/$SKILL_NAME"
fi
mkdir -p "$INSTALL_DIR"
echo "目标安装目录: $INSTALL_DIR"

TMP_ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/ash-pull.XXXXXX")"
trap 'rm -f "$TMP_ARCHIVE"' EXIT
# 归档顶层带 <slug>/ 目录，--strip-components=1 去掉，避免嵌套成 <slug>/<slug>/
if curl -fsSL "$BASE_URL/s/$SKILL_NAME/archive.tar.gz?pending=$PENDING" -o "$TMP_ARCHIVE"; then
  tar -xzf "$TMP_ARCHIVE" -C "$INSTALL_DIR" --strip-components=1
  echo "✓ 完整技能包解压成功"
else
  echo "⚠️  完整技能包下载失败，改为只拉取 SKILL.md" >&2
  curl -fsSL "$BASE_URL/s/$SKILL_NAME.md?raw=1&pending=$PENDING" -o "$INSTALL_DIR/SKILL.md"
fi

# 兼容旧版脚本安装过的嵌套目录：<INSTALL_DIR>/<slug>/... 拍平到根
if [ -d "$INSTALL_DIR/$SKILL_NAME" ]; then
  (shopt -s dotglob; mv "$INSTALL_DIR/$SKILL_NAME"/* "$INSTALL_DIR/" 2>/dev/null || true)
  rmdir "$INSTALL_DIR/$SKILL_NAME" 2>/dev/null || true
  echo "✓ 已修正历史版本的嵌套目录结构"
fi

if [ -d "$INSTALL_DIR/scripts" ]; then
  chmod +x "$INSTALL_DIR/scripts"/* 2>/dev/null || true
  echo "✓ 已赋予脚本执行权限 (scripts/*)"
fi

echo "✅ 技能 [$SKILL_NAME] 已安装到 $INSTALL_DIR"
echo "   下一步：阅读 $INSTALL_DIR/SKILL.md 并按其步骤执行"
