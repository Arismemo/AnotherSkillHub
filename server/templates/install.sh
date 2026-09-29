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
REASON=__REASON__
PIN=__PIN__
FOOTER_MARK=__FOOTER_MARK__
FOOTER=__FOOTER__
DEPS=(__DEPS__)
TERMINAL="${ASH_TERMINAL:-$(hostname 2>/dev/null || echo Unknown-Host)}"

# 个人 API token：不写进脚本，运行时从环境变量或 ash login 保存的文件读取，并导出给依赖安装
ASH_TOKEN="${ASH_TOKEN:-$(cat "$HOME/.ash/token" 2>/dev/null || true)}"
export ASH_TOKEN
AUTH=()
if [ -n "$ASH_TOKEN" ]; then AUTH=(-H "Authorization: Bearer $ASH_TOKEN"); fi

echo "📦 AnotherSkillHub: 正在安装技能 [$SKILL_NAME]"

# 自动探测：ASH_SKILLS_DIR > 在 Claude Code 里运行时装到 ~/.claude/skills > 唯一的 hermes profile > 已存在的常见目录 > ~/.agents/skills
# Claude Code 只从 ~/.claude/skills（和项目的 .claude/skills）加载技能：装到别处它既看不到这个技能，也按名字调用不到它引用的技能
detect_root() {
  if [ -n "${ASH_SKILLS_DIR:-}" ]; then echo "$ASH_SKILLS_DIR"; return; fi
  if [ "${CLAUDECODE:-}" = "1" ]; then echo "$HOME/.claude/skills"; return; fi
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
# reason / terminal 让服务端记下「装到了哪台机器上」（安装、依赖、更新分开统计）
if curl -fsSL -G ${AUTH[@]+"${AUTH[@]}"} --data-urlencode "pending=$PENDING" --data-urlencode "reason=$REASON" \
  --data-urlencode "terminal=$TERMINAL" --data-urlencode "pin=$PIN" "$BASE_URL/s/$SKILL_NAME/archive.tar.gz" -o "$TMP_ARCHIVE"; then
  tar -xzf "$TMP_ARCHIVE" -C "$STAGING" --strip-components=1
  echo "✓ 完整技能包下载成功"
else
  echo "⚠️  完整技能包下载失败，改为只拉取 SKILL.md" >&2
  curl -fsSL -G ${AUTH[@]+"${AUTH[@]}"} --data-urlencode "raw=1" --data-urlencode "pending=$PENDING" --data-urlencode "pin=$PIN" \
    "$BASE_URL/s/$SKILL_NAME.md" -o "$STAGING/SKILL.md"
fi
rm -f "$STAGING/.ash"
if [ -d "$STAGING/scripts" ]; then
  chmod +x "$STAGING/scripts"/* 2>/dev/null || true
fi
# 末尾附一段说明：引用的技能在本机哪里、用完怎么反馈。Agent 每次按技能干活都会读 SKILL.md，这是告诉它的唯一地方。
# 推送回库时服务端会去掉这段；ASH_FEEDBACK_HINT=0 可不加
if [ "${ASH_FEEDBACK_HINT:-1}" != "0" ] && [ -f "$STAGING/SKILL.md" ]; then
  printf '\n%s\n%s\n' "$FOOTER_MARK" "$FOOTER" >> "$STAGING/SKILL.md"
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
  printf 'pinned=%s\n' "$PIN"
  # 引用的技能（ash doctor 据此检查它们是否都在同一目录）
  printf 'deps=%s\n' "$(IFS=,; echo "${DEPS[*]+"${DEPS[*]}"}")"
  printf 'fingerprint=%s\n' "$(ash_fingerprint "$INSTALL_DIR")"
  printf 'installed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$INSTALL_DIR/.ash"

echo "✅ 技能 [$SKILL_NAME] v$VERSION 已安装到 $INSTALL_DIR"

# 依赖：装到同一目录；已安装的不动；ASH_DEPS_SEEN 防止循环依赖
if [ "$NODEPS" != "1" ] && [ "${#DEPS[@]}" -gt 0 ]; then
  export ASH_DEPS_SEEN="${ASH_DEPS_SEEN:-},$SKILL_NAME,"
  for spec in "${DEPS[@]}"; do
    # 依赖可以固定版本：slug@1.2.0
    dep="${spec%%@*}"; dep_pin=""
    case "$spec" in *@*) dep_pin="${spec#*@}" ;; esac
    case "$ASH_DEPS_SEEN" in *",$dep,"*) continue ;; esac
    if [ -f "$SKILLS_ROOT/$dep/.ash" ]; then
      have="$(sed -n 's/^version=//p' "$SKILLS_ROOT/$dep/.ash")"
      if [ -n "$dep_pin" ] && [ "$have" != "$dep_pin" ]; then
        echo "⚠️  依赖 $dep 已安装 v$have，本技能固定要求 v$dep_pin，没有覆盖（需要时 ash pull $dep@$dep_pin）" >&2
      else
        echo "↳ 依赖 $dep 已安装，跳过"
      fi
      continue
    fi
    echo "↳ 安装依赖 $spec"
    if ! dep_script="$(curl -fsS -G ${AUTH[@]+"${AUTH[@]}"} --data-urlencode "reason=dependency" --data-urlencode "pin=$dep_pin" "$BASE_URL/s/$dep/install.sh")" \
      || ! printf '%s\n' "$dep_script" | ASH_SKILLS_DIR="$SKILLS_ROOT" bash; then
      echo "⚠️  依赖 $dep 安装失败（不存在、未发布或网络错误），请手动处理" >&2
    fi
  done
fi

echo "   下一步：阅读 $INSTALL_DIR/SKILL.md 并按其步骤执行；用完运行 ash feedback $SKILL_NAME ok|fail"
