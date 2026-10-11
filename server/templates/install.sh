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
# 完整包与只取 SKILL.md 的地址；从分享链接安装时 SHARE_URL 非空（SHARE_ACCESS 是密码分享解锁后的访问凭据）
ARCHIVE_URL=__ARCHIVE_URL__
RAW_URL=__RAW_URL__
SHARE_URL=__SHARE_URL__
SHARE_ACCESS=__SHARE_ACCESS__
TERMINAL="${ASH_TERMINAL:-$(hostname 2>/dev/null || echo Unknown-Host)}"

AUTH=()
if [ -n "$SHARE_URL" ]; then
  # 分享可能来自别的服务器：不读取、不发送个人 token，只带分享自己的访问凭据
  if [ -n "$SHARE_ACCESS" ]; then AUTH=(-H "X-ASH-Share-Access: $SHARE_ACCESS"); fi
else
  # 个人 API token：不写进脚本，运行时从环境变量或 ash login 保存的文件读取，并导出给依赖安装
  ASH_TOKEN="${ASH_TOKEN:-$(cat "$HOME/.ash/token" 2>/dev/null || true)}"
  export ASH_TOKEN
  if [ -n "$ASH_TOKEN" ]; then AUTH=(-H "Authorization: Bearer $ASH_TOKEN"); fi
fi

echo "📦 AnotherSkillHub: 正在安装技能 [$SKILL_NAME]"

# 两种装法：
#   共享存储（默认）：技能只在 ~/.ash/skills/<slug>（ASH_STORE 可改）存一份，各 Agent 的技能目录里放指向它的符号链接。
#     库里装来的和 Agent 自带、自己写的技能不混在一起；一台机器上几个 Agent 用的是同一份、同一个版本
#   指定目录（--dir 或 ASH_SKILLS_DIR）：文件直接装进那个目录，不建链接
STORE="${ASH_STORE:-$HOME/.ash/skills}"

# 本机各个 Agent 加载技能的目录（与 ash CLI 共用一份定义）
__AGENT_ROOTS_FN__

# 本机还没有任何 Agent 目录时的兜底：唯一的 hermes profile > 已存在的常见目录 > ~/.agents/skills
fallback_root() {
  if [ -d "$HOME/.hermes/profiles" ]; then
    set -- "$HOME"/.hermes/profiles/*/skills
    if [ "$#" -eq 1 ] && [ -d "$1" ]; then echo "$1"; return; fi
  fi
  for d in "$HOME/.hermes/skills" "$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.dsh/skills"; do
    if [ -d "$d" ]; then echo "$d"; return; fi
  done
  echo "$HOME/.agents/skills"
}

# 共享存储时要链接到哪些 Agent 目录（每行一个）。ASH_LINK_ROOTS 由 ash CLI 和依赖安装传入（"-" 表示不建链接）
link_roots() {
  if [ -n "${ASH_LINK_ROOTS:-}" ]; then
    if [ "$ASH_LINK_ROOTS" != "-" ]; then printf '%s\n' "$ASH_LINK_ROOTS"; fi
    return
  fi
  case "$AGENT_TARGET" in
    hermes) echo "$HOME/.hermes/skills" ;;
    codex)  echo "$HOME/.agents/skills" ;;
    claude) echo "$HOME/.claude/skills" ;;
    dsh)    echo "$HOME/.dsh/skills" ;;
    *)
      # 默认链到本机每个 Agent。在 Claude Code 里运行时一定包括 ~/.claude/skills：它只从那里加载技能
      local roots
      roots="$(agent_roots)"
      {
        if [ "${CLAUDECODE:-}" = "1" ]; then echo "$HOME/.claude/skills"; fi
        if [ -n "$roots" ]; then printf '%s\n' "$roots"
        elif [ "${CLAUDECODE:-}" != "1" ]; then fallback_root; fi
      } | awk 'NF && !seen[$0]++'
      ;;
  esac
}

# 技能目录内容指纹（不含 .ash，也不含运行脚本时生成的 __pycache__ / *.pyc 和 .DS_Store）：判断本地是否改过。与 ash CLI 中的定义保持一致
ash_fingerprint() {
  (cd "$1" && find . -name __pycache__ -prune -o -type f ! -name .ash ! -name '*.pyc' ! -name .DS_Store -print | LC_ALL=C sort | while IFS= read -r f; do printf '%s\n' "$f"; cat "$f"; done) | cksum | awk '{print $1 "-" $2}'
}

# 备份目录：每次一个新目录，同一秒里备份同名技能也不会互相覆盖
backup_path() {
  local base p n=1
  base="$HOME/.ash/backups/$1-$(date +%Y%m%d%H%M%S)"
  p="$base"
  while [ -e "$p" ]; do n=$((n + 1)); p="$base-$n"; done
  mkdir -p "$(dirname "$p")"
  echo "$p"
}

# 同名目录要被替换时：本地改过的、或不是 ash 安装的，先备份到 ~/.ash/backups（--force 跳过备份）
set_aside() {
  local dir="$1" why="" recorded backup
  if [ -f "$dir/.ash" ]; then
    recorded="$(sed -n 's/^fingerprint=//p' "$dir/.ash")"
    if [ "$recorded" != "$(ash_fingerprint "$dir")" ]; then why="本地有修改"; fi
  else
    why="不是由 ash 安装的"
  fi
  if [ -n "$why" ] && [ "$FORCE" != "1" ]; then
    backup="$(backup_path "$(basename "$dir")")"
    mv "$dir" "$backup"
    echo "⚠️  ${dir} ${why}，已备份到 $backup" >&2
  else
    rm -rf "$dir"
  fi
}

# 把共享存储里的技能链接进一个 Agent 目录。别的工具建的链接（例如上游安装器）不动
link_into() {
  local slug="$1" root="$2" target="$2/$1" src="$STORE/$1"
  mkdir -p "$root"
  if [ -L "$target" ]; then
    if [ "$(readlink "$target")" = "$src" ]; then return 0; fi
    if [ -e "$target" ]; then
      echo "⚠️  $target 是指向 $(readlink "$target") 的链接，不是 ash 建的，没有改动（要用库里的版本请先删掉它）" >&2
      return 0
    fi
    rm -f "$target" # 指向已不存在位置的旧链接
  elif [ -e "$target" ]; then
    set_aside "$target"
  fi
  ln -s "$src" "$target"
  echo "↳ 已链接 $target → $src"
}

case "$CUSTOM_DIR" in
  "~") CUSTOM_DIR="$HOME" ;;
  "~/"*) CUSTOM_DIR="$HOME/${CUSTOM_DIR#\~/}" ;;
esac
if [ -n "$CUSTOM_DIR" ]; then MODE=dir; SKILLS_ROOT="$CUSTOM_DIR"
elif [ -n "${ASH_SKILLS_DIR:-}" ]; then MODE=dir; SKILLS_ROOT="$ASH_SKILLS_DIR"
else MODE=store; SKILLS_ROOT="$STORE"; fi
LINKS=""
if [ "$MODE" = store ]; then LINKS="$(link_roots)"; fi
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
  --data-urlencode "terminal=$TERMINAL" --data-urlencode "pin=$PIN" "$ARCHIVE_URL" -o "$TMP_ARCHIVE"; then
  tar -xzf "$TMP_ARCHIVE" -C "$STAGING" --strip-components=1
  echo "✓ 完整技能包下载成功"
else
  echo "⚠️  完整技能包下载失败，改为只拉取 SKILL.md" >&2
  curl -fsSL -G ${AUTH[@]+"${AUTH[@]}"} --data-urlencode "raw=1" --data-urlencode "pending=$PENDING" --data-urlencode "pin=$PIN" \
    "$RAW_URL" -o "$STAGING/SKILL.md"
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

if [ -e "$INSTALL_DIR" ] || [ -L "$INSTALL_DIR" ]; then
  if [ -d "$INSTALL_DIR" ] && [ ! -L "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then set_aside "$INSTALL_DIR"
  else rm -rf "$INSTALL_DIR"; fi
fi
mv "$STAGING" "$INSTALL_DIR"

{
  printf 'slug=%s\n' "$SKILL_NAME"
  printf 'server=%s\n' "$BASE_URL"
  printf 'revision=%s\n' "$REVISION"
  printf 'version=%s\n' "$VERSION"
  printf 'pending=%s\n' "$PENDING"
  printf 'pinned=%s\n' "$PIN"
  # 来自分享链接：ash installed / pull --all 据此跳过本库比对，重新安装用 ash pull <分享链接>
  printf 'share=%s\n' "$SHARE_URL"
  # 引用的技能（ash doctor 据此检查它们是否都在同一目录）
  printf 'deps=%s\n' "$(IFS=,; echo "${DEPS[*]+"${DEPS[*]}"}")"
  printf 'fingerprint=%s\n' "$(ash_fingerprint "$INSTALL_DIR")"
  printf 'installed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$INSTALL_DIR/.ash"

echo "✅ 技能 [$SKILL_NAME] v$VERSION 已安装到 $INSTALL_DIR"
while IFS= read -r root; do
  if [ -n "$root" ]; then link_into "$SKILL_NAME" "$root"; fi
done <<EOF
$LINKS
EOF
if [ "$MODE" = store ] && [ -z "$LINKS" ]; then
  echo "   （没有链接到任何 Agent 目录：ash pull $SKILL_NAME --agent <claude|codex|hermes|dsh> 链接过去）"
fi

# 依赖：装到同一处（共享存储时也链接进同样的 Agent 目录，相对链接 ../<slug>/SKILL.md 两边都对得上）；
# 已安装的不重装；ASH_DEPS_SEEN 防止循环依赖
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
      while IFS= read -r root; do
        if [ -n "$root" ]; then link_into "$dep" "$root"; fi
      done <<EOF
$LINKS
EOF
      continue
    fi
    echo "↳ 安装依赖 $spec"
    if [ "$MODE" = store ]; then
      dep_env=(ASH_LINK_ROOTS="${LINKS:--}")
    else
      dep_env=(ASH_SKILLS_DIR="$SKILLS_ROOT")
    fi
    if ! dep_script="$(curl -fsS -G ${AUTH[@]+"${AUTH[@]}"} --data-urlencode "reason=dependency" --data-urlencode "pin=$dep_pin" "$BASE_URL/s/$dep/install.sh")" \
      || ! printf '%s\n' "$dep_script" | env "${dep_env[@]}" bash; then
      echo "⚠️  依赖 $dep 安装失败（不存在、未发布或网络错误），请手动处理" >&2
    fi
  done
fi

if [ -n "$SHARE_URL" ]; then
  echo "   下一步：阅读 $INSTALL_DIR/SKILL.md 并按其步骤执行；分享者更新后重新运行 ash pull $SHARE_URL"
else
  echo "   下一步：阅读 $INSTALL_DIR/SKILL.md 并按其步骤执行；用完运行 ash feedback $SKILL_NAME ok|fail"
fi
