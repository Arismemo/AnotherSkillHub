#!/usr/bin/env bash
# ash — AnotherSkillHub CLI（由服务端 /cli.sh 生成；`ash update` 更新到服务端最新版）
# 兼容 macOS 自带的 bash 3.2：不使用关联数组、mapfile 等 bash 4 特性
set -euo pipefail

DEFAULT_SERVER_URL=__SERVER_URL__
SERVER_URL="${ASH_SERVER_URL:-$DEFAULT_SERVER_URL}"
SERVER_URL="${SERVER_URL%/}"
TERMINAL="${ASH_TERMINAL:-$(hostname 2>/dev/null || echo Unknown-Host)}"

# 个人 API token：ASH_TOKEN 优先，否则取 ash login 保存的 ~/.ash/token。导出给安装脚本（及其依赖安装）继续使用
TOKEN_FILE="$HOME/.ash/token"
ASH_TOKEN="${ASH_TOKEN:-$(cat "$TOKEN_FILE" 2>/dev/null || true)}"
export ASH_TOKEN
AUTH=()
if [ -n "$ASH_TOKEN" ]; then AUTH=(-H "Authorization: Bearer $ASH_TOKEN"); fi

die() { echo "错误: $*" >&2; exit 1; }

# 调用接口：成功时输出响应体；HTTP ≥400 时把服务端返回的错误信息输出到 stderr 并返回非零
http() {
  local out code body
  out=$(curl -sS -w '\n%{http_code}' ${AUTH[@]+"${AUTH[@]}"} "$@") || die "无法连接 $SERVER_URL"
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
  body="${body%$'\n'}"
  if [ "$code" -ge 400 ] 2>/dev/null; then
    printf '%s\n' "$body" >&2
    if [ "$code" = 401 ]; then
      if [ -n "$ASH_TOKEN" ]; then echo "提示: token 无效或已吊销，请重新运行 ash login" >&2
      else echo "提示: 尚未登录，请先运行 ash login" >&2; fi
    fi
    return 1
  fi
  printf '%s\n' "$body"
}

# 从 JSON 响应里取一个字符串字段（值里没有引号的简单场景：token、用户名）
json_field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" | head -n 1; }

valid_slug() { [[ "$1" =~ ^[A-Za-z0-9_.-]+$ ]] || die "非法的技能标识符: $1"; }

# 路径段编码：逐字节 %XX，支持中文组合名
urlencode() { printf '%s' "$1" | od -An -tx1 -v | tr -d ' \n' | sed 's/../%&/g'; }

# 技能目录内容指纹（不含 .ash）：与服务端 install.sh 中的定义保持一致
ash_fingerprint() {
  (cd "$1" && find . -type f ! -name .ash -print | LC_ALL=C sort | while IFS= read -r f; do printf '%s\n' "$f"; cat "$f"; done) | cksum | awk '{print $1 "-" $2}'
}

meta() { sed -n "s/^$2=//p" "$1/.ash" 2>/dev/null | head -n 1; }

# 可能存放技能的目录：--dir 指定 > ASH_SKILLS_DIR > hermes profiles > 常见目录（去重）
skill_roots() {
  local d
  {
    if [ -n "${1:-}" ]; then echo "$1"; fi
    if [ -n "${ASH_SKILLS_DIR:-}" ]; then echo "$ASH_SKILLS_DIR"; fi
    for d in "$HOME"/.hermes/profiles/*/skills "$HOME/.hermes/skills" "$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.dsh/skills"; do
      if [ -d "$d" ]; then echo "$d"; fi
    done
  } | awk '!seen[$0]++'
}

# 已由 ash 安装的技能目录（含 .ash 元数据），每行一个目录
installed_dirs() {
  local root f
  skill_roots "${1:-}" | while IFS= read -r root; do
    for f in "$root"/*/.ash; do
      if [ -f "$f" ]; then dirname "$f"; fi
    done
  done
}

# 批量查询服务端状态：每行 slug<TAB>状态<TAB>修订<TAB>版本
fetch_revisions() {
  local args=(-G) dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    args+=(--data-urlencode "slug=$(meta "$dir" slug)")
  done
  if [ "${#args[@]}" -gt 1 ]; then http "${args[@]}" "$SERVER_URL/api/agent/revisions"; fi
}

# 单个已装技能的状态：输出 "代码<TAB>说明"
# 代码: ok | outdated | modified | modified-outdated | missing | trashed | other-server
skill_state() {
  local dir="$1" revs="$2" slug server rev line rstatus rrev rver modified=0
  slug="$(meta "$dir" slug)"; server="$(meta "$dir" server)"; rev="$(meta "$dir" revision)"
  if [ "$server" != "$SERVER_URL" ]; then printf 'other-server\t来自其它服务 %s\n' "$server"; return; fi
  line="$(printf '%s\n' "$revs" | awk -F'\t' -v s="$slug" '$1 == s { print; exit }')"
  rstatus="$(printf '%s' "$line" | cut -f2)"; rrev="$(printf '%s' "$line" | cut -f3)"; rver="$(printf '%s' "$line" | cut -f4)"
  if [ "$(meta "$dir" fingerprint)" != "$(ash_fingerprint "$dir")" ]; then modified=1; fi
  case "$rstatus" in
    missing) printf 'missing\t远端已删除\n'; return ;;
    trashed) printf 'trashed\t远端在废纸篓\n'; return ;;
  esac
  if [ "$rrev" != "$rev" ]; then
    if [ "$modified" = 1 ]; then printf 'modified-outdated\t本地有修改 · 远端有更新 v%s\n' "$rver"
    else printf 'outdated\t有更新 → v%s\n' "$rver"; fi
  elif [ "$modified" = 1 ]; then printf 'modified\t本地有修改\n'
  elif [ "$rstatus" = "pending" ]; then printf 'ok\t最新（仍在待审核）\n'
  else printf 'ok\t最新\n'; fi
}

# 安装脚本：服务端对不存在/待审核等情况也返回可执行脚本（输出原因并 exit 1），所以不看状态码
run_install() {
  local url="$1"; shift
  local script
  script="$(curl -sS -G ${AUTH[@]+"${AUTH[@]}"} "$@" "$url")" || die "无法连接 $SERVER_URL"
  printf '%s\n' "$script" | bash
}

# 安装到 bin 目录：优先可写目录，其次免密 sudo（sudo -n 不会卡住无人值守的 Agent），最后 ~/.local/bin
install_to_bin() {
  local src="$1" bin_dir="${ASH_BIN_DIR:-}" use_sudo=""
  if [ -z "$bin_dir" ]; then
    local current
    current="$(command -v ash 2>/dev/null || true)"
    if [ -n "$current" ] && [ -w "$(dirname "$current")" ]; then bin_dir="$(dirname "$current")"
    elif [ -w /usr/local/bin ]; then bin_dir=/usr/local/bin
    elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then bin_dir=/usr/local/bin; use_sudo="sudo -n"
    else bin_dir="$HOME/.local/bin"; fi
  fi
  $use_sudo mkdir -p "$bin_dir"
  $use_sudo mv "$src" "$bin_dir/ash"
  $use_sudo chmod +x "$bin_dir/ash"
  echo "✓ 已写入 $bin_dir/ash"
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) echo "⚠️  $bin_dir 不在 PATH 中，请执行：export PATH=\"$bin_dir:\$PATH\"（并写入 shell 配置）" ;;
  esac
}

fetch_self() {
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/ash.XXXXXX")"
  curl -fsSL "$SERVER_URL/cli.sh" -o "$tmp" || { rm -f "$tmp"; die "下载 $SERVER_URL/cli.sh 失败"; }
  chmod +x "$tmp"
  install_to_bin "$tmp"
}

# 通过 curl|bash 管道执行（$0 为 bash/sh）或显式 `install` 时走安装分支
if [ "$0" = "bash" ] || [ "$0" = "sh" ] || [ "${1:-}" = "install" ]; then
  echo "🚀 正在安装 AnotherSkillHub 命令行工具 ash（服务: ${SERVER_URL}）"
  fetch_self
  echo "✅ 安装完成。Agent 使用说明：ash guide"
  exit 0
fi

show_help() {
  cat <<EOF
AnotherSkillHub CLI · 服务地址: $SERVER_URL

查找
  ash search <关键词…> [--tag T] [--folder F] [--json]   搜索已发布技能（多个关键词需同时命中）
  ash list [--tag T] [--folder F] [--json]               列出已发布技能
  ash info <slug>                 描述、依赖、文件清单、版本与安装命令
  ash show <slug> [--version ID] [--pending]             直接输出 SKILL.md（不安装）
  ash versions <slug>             历史版本列表

技能组合
  ash bundles [--json]            列出全部组合
  ash bundle <标识或名称>          查看组合成员

安装与本地管理
  ash pull <slug> [--agent claude|codex|hermes|dsh] [--dir PATH] [--pending] [--force] [--no-deps]
                                  安装技能及其依赖；本地改过的同名目录先备份到 ~/.ash/backups（--force 不备份）
  ash pull bundle:<标识或名称>     一次安装整个技能组合
  ash pull --all [--dir PATH] [--force]   更新所有过期的已装技能（本地改过的跳过，除非 --force）
  ash installed [--dir PATH]      本机已装技能及状态（最新 / 有更新 / 本地有修改 / 远端已删除）
  ash outdated [--dir PATH]       只列出需要处理的已装技能
  ash remove <slug> [--dir PATH] [--force] 卸载；本地改过的先备份（--force 直接删除）

推送与审核
  ash push <技能目录|SKILL.md> [--update] [--folder PATH] [--json]
                                  同名技能已存在时需加 --update；推送内容需人工审核后对其他 Agent 可见
  ash mine                        我（本机）推送的技能及审核状态
  ash withdraw <slug>             撤回自己尚在待审核的推送

账号
  ash login [--token TOKEN]       登录：输入用户名密码换取 token，或直接保存网页「账户」里创建的 token
  ash whoami                      当前登录的账号
  ash logout                      删除本机保存的 token（要让它彻底失效，请在网页「账户」里吊销）

其它
  ash guide                       Agent 使用指南
  ash open                        在浏览器打开管理后台
  ash update                      更新 ash 自身

完整文档：$SERVER_URL/docs
环境变量：ASH_SERVER_URL 服务地址；ASH_TOKEN API token（默认读 ~/.ash/token）；ASH_SKILLS_DIR 默认安装目录；ASH_BIN_DIR ash 安装位置；ASH_TERMINAL 推送来源名（默认 hostname）
EOF
}

# search/list 共用的筛选参数：填充 filter_args 与 json
parse_filters() {
  filter_args=(-G); json=0; words=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --json) json=1; shift ;;
      --tag) [ -n "${2:-}" ] || die "--tag 需要参数"; filter_args+=(--data-urlencode "tag=$2"); shift 2 ;;
      --folder) [ -n "${2:-}" ] || die "--folder 需要参数"; filter_args+=(--data-urlencode "folder=$2"); shift 2 ;;
      *) words+=("$1"); shift ;;
    esac
  done
  if [ "$json" = 0 ]; then filter_args+=(--data-urlencode "format=text"); fi
}

cmd="${1:-help}"
[ "$#" -gt 0 ] && shift

case "$cmd" in
  pull)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)、组合 (bundle:<标识或名称>) 或 --all"
    target="$1"; shift
    args=(); dir=""; force=0
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --agent) [ -n "${2:-}" ] || die "--agent 需要参数"; args+=(--data-urlencode "agent=$2"); shift 2 ;;
        --dir) [ -n "${2:-}" ] || die "--dir 需要参数"; dir="$2"; args+=(--data-urlencode "dir=$2"); shift 2 ;;
        --pending) args+=(--data-urlencode "pending=1"); shift ;;
        --force) force=1; args+=(--data-urlencode "force=1"); shift ;;
        --no-deps) args+=(--data-urlencode "nodeps=1"); shift ;;
        *) die "未知参数: $1" ;;
      esac
    done
    if [ "$target" = "--all" ]; then
      dirs="$(installed_dirs "$dir")"
      [ -n "$dirs" ] || { echo "本机没有通过 ash 安装的技能"; exit 0; }
      revs="$(printf '%s\n' "$dirs" | fetch_revisions)"
      updated=0; skipped=0; failed=0
      while IFS= read -r d; do
        slug="$(meta "$d" slug)"
        state="$(skill_state "$d" "$revs")"; code="${state%%$'\t'*}"; note="${state#*$'\t'}"
        extra=()
        if [ "$force" = 1 ]; then extra+=(--data-urlencode "force=1"); fi
        if [ "$(meta "$d" pending)" = 1 ]; then extra+=(--data-urlencode "pending=1"); fi
        case "$code" in
          outdated) ;;
          modified-outdated)
            if [ "$force" != 1 ]; then echo "⏭  ${slug}：${note}，跳过（ash pull $slug 会先备份再覆盖，或加 --force）"; skipped=$((skipped + 1)); continue; fi ;;
          missing|trashed) echo "⚠️  ${slug}：$note"; continue ;;
          *) continue ;;
        esac
        # 装回原来的目录：把它的上级目录作为安装根目录
        if ASH_SKILLS_DIR="$(dirname "$d")" run_install "$SERVER_URL/s/$slug/install.sh" "${extra[@]+"${extra[@]}"}"; then updated=$((updated + 1)); else failed=$((failed + 1)); fi
      done <<EOF
$dirs
EOF
      echo "完成：更新 $updated 个，跳过 $skipped 个，失败 $failed 个"
      [ "$failed" = 0 ] || exit 1
    elif [ "${target#bundle:}" != "$target" ]; then
      run_install "$SERVER_URL/s/bundle/$(urlencode "${target#bundle:}")/install.sh" "${args[@]+"${args[@]}"}"
    else
      valid_slug "$target"
      run_install "$SERVER_URL/s/$target/install.sh" "${args[@]+"${args[@]}"}"
    fi
    ;;
  installed|outdated)
    dir=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --dir) [ -n "${2:-}" ] || die "--dir 需要参数"; dir="$2"; shift 2 ;;
        *) die "未知参数: $1" ;;
      esac
    done
    dirs="$(installed_dirs "$dir")"
    [ -n "$dirs" ] || { echo "本机没有通过 ash 安装的技能"; exit 0; }
    revs="$(printf '%s\n' "$dirs" | fetch_revisions)"
    shown=0
    while IFS= read -r d; do
      state="$(skill_state "$d" "$revs")"; code="${state%%$'\t'*}"; note="${state#*$'\t'}"
      if [ "$cmd" = "outdated" ] && [ "$code" = "ok" ]; then continue; fi
      printf '%s  ·  v%s  ·  %s  ·  %s\n' "$(meta "$d" slug)" "$(meta "$d" version)" "$note" "$d"
      shown=$((shown + 1))
    done <<EOF
$dirs
EOF
    if [ "$shown" = 0 ]; then echo "所有已装技能都是最新的"
    elif [ "$cmd" = "outdated" ]; then echo "（ash pull --all 更新全部；本地改过的需单独 ash pull <slug>，会先备份）"; fi
    ;;
  remove)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)"
    slug="$1"; shift; valid_slug "$slug"; dir=""; force=0
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --dir) [ -n "${2:-}" ] || die "--dir 需要参数"; dir="$2"; shift 2 ;;
        --force) force=1; shift ;;
        *) die "未知参数: $1" ;;
      esac
    done
    removed=0
    while IFS= read -r d; do
      [ -n "$d" ] || continue
      [ "$(meta "$d" slug)" = "$slug" ] || continue
      if [ "$force" != 1 ] && [ "$(meta "$d" fingerprint)" != "$(ash_fingerprint "$d")" ]; then
        backup="$HOME/.ash/backups/$slug-$(date +%Y%m%d%H%M%S)"
        mkdir -p "$(dirname "$backup")"
        mv "$d" "$backup"
        echo "✓ 已卸载 ${d}（本地有修改，已备份到 ${backup}）"
      else
        rm -rf "$d"
        echo "✓ 已卸载 $d"
      fi
      removed=$((removed + 1))
    done <<EOF
$(installed_dirs "$dir")
EOF
    [ "$removed" -gt 0 ] || die "没有找到由 ash 安装的 ${slug}（不是 ash 安装的目录不会被删除）"
    ;;
  list)
    parse_filters "$@"
    http "${filter_args[@]}" "$SERVER_URL/api/skills"
    ;;
  search)
    parse_filters "$@"
    [ "${#words[@]}" -gt 0 ] || die "请提供搜索关键词"
    http "${filter_args[@]}" --data-urlencode "search=${words[*]}" "$SERVER_URL/api/skills"
    ;;
  info)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)"; valid_slug "$1"
    http "$SERVER_URL/s/$1/info"
    ;;
  show)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)"; slug="$1"; shift; valid_slug "$slug"
    args=(-G)
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --pending) args+=(--data-urlencode "pending=1"); shift ;;
        --version) [ -n "${2:-}" ] || die "--version 需要参数（ash versions $slug 查看）"; args+=(--data-urlencode "version=$2"); shift 2 ;;
        *) die "未知参数: $1" ;;
      esac
    done
    http "${args[@]}" -H 'Accept: text/markdown' "$SERVER_URL/s/$slug.md"
    ;;
  versions)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)"; valid_slug "$1"
    http "$SERVER_URL/s/$1/versions"
    ;;
  bundles)
    if [ "${1:-}" = "--json" ]; then http "$SERVER_URL/api/bundles"
    else http -G --data-urlencode "format=text" "$SERVER_URL/api/bundles"; fi
    ;;
  bundle)
    [ -n "${1:-}" ] || die "请提供组合标识或名称（ash bundles 查看全部）"
    if [ "${2:-}" = "--json" ]; then http "$SERVER_URL/api/bundles/$(urlencode "$1")"
    else http -G --data-urlencode "format=text" "$SERVER_URL/api/bundles/$(urlencode "$1")"; fi
    ;;
  push)
    target="./SKILL.md"; update=0; folder=""; json=0
    if [ "$#" -gt 0 ] && [ "${1#--}" = "$1" ]; then target="$1"; shift; fi
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --update) update=1; shift ;;
        --folder) [ -n "${2:-}" ] || die "--folder 需要参数"; folder="$2"; shift 2 ;;
        --json) json=1; shift ;;
        *) die "未知参数: $1" ;;
      esac
    done
    form=(-F "terminal=$TERMINAL" -F "update=$update")
    if [ -n "$folder" ]; then form+=(-F "folder=$folder"); fi
    if [ "$json" = 0 ]; then form+=(-F "format=text"); fi
    if [ -d "$target" ]; then
      [ -f "$target/SKILL.md" ] || die "目录中缺少 SKILL.md：$target"
      archive="$(mktemp "${TMPDIR:-/tmp}/ash-push.XXXXXX")"
      trap 'rm -f "$archive"' EXIT
      COPYFILE_DISABLE=1 tar -czf "$archive" --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
        --exclude='.DS_Store' --exclude='._*' --exclude='./.ash' -C "$target" .
      nfiles="$(tar -tzf "$archive" | grep -vc '/$' || true)"
      echo "→ 推送目录 ${target}（$nfiles 个文件，来源 ${TERMINAL}）" >&2
      http -X POST "$SERVER_URL/api/agent/push" -F "file=@$archive;filename=skill.tar.gz;type=application/gzip" "${form[@]}"
    else
      [ -f "$target" ] || die "找不到技能文件或目录: $target"
      echo "→ 推送文件 ${target}（来源 ${TERMINAL}）" >&2
      http -X POST "$SERVER_URL/api/agent/push" -F "file=@$target" "${form[@]}"
    fi
    ;;
  mine)
    http -G --data-urlencode "terminal=$TERMINAL" "$SERVER_URL/api/agent/mine"
    ;;
  withdraw)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)"; valid_slug "$1"
    http -X POST --data-urlencode "slug=$1" --data-urlencode "terminal=$TERMINAL" "$SERVER_URL/api/agent/withdraw"
    ;;
  login)
    token=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --token) [ -n "${2:-}" ] || die "--token 需要参数"; token="$2"; shift 2 ;;
        *) die "未知参数: $1" ;;
      esac
    done
    if [ -z "$token" ]; then
      [ -r /dev/tty ] || die "无法交互输入：请在网页「账户」里创建 token，然后运行 ash login --token <token>"
      printf '用户名: ' >&2; IFS= read -r username </dev/tty
      printf '密码: ' >&2; IFS= read -rs password </dev/tty; echo >&2
      # 密码走标准输入（password@-），不出现在进程参数里
      resp="$(AUTH=(); printf '%s' "$password" | http -X POST -H 'X-ASH-Request: 1' --data-urlencode "username=$username" \
        --data-urlencode "password@-" --data-urlencode "terminal=$TERMINAL" "$SERVER_URL/api/auth/cli-token")" || exit 1
      password=
      token="$(printf '%s' "$resp" | json_field token)"
      [ -n "$token" ] || die "服务端没有返回 token"
    fi
    AUTH=(-H "Authorization: Bearer $token")
    me="$(http "$SERVER_URL/api/auth/me")" || die "token 校验失败，未保存"
    mkdir -p "$(dirname "$TOKEN_FILE")"
    (umask 077; printf '%s\n' "$token" > "$TOKEN_FILE")
    chmod 600 "$TOKEN_FILE"
    echo "✅ 已登录为 $(printf '%s' "$me" | json_field username)（token 保存在 ${TOKEN_FILE}）"
    ;;
  whoami)
    me="$(http "$SERVER_URL/api/auth/me")" || exit 1
    echo "$(printf '%s' "$me" | json_field username) @ $SERVER_URL"
    ;;
  logout)
    rm -f "$TOKEN_FILE"
    echo "✓ 已删除本机 token。它在服务端仍然有效，如需作废请到网页「账户」里吊销"
    ;;
  guide)
    http "$SERVER_URL/agent.md"
    ;;
  open)
    if command -v open >/dev/null 2>&1; then open "$SERVER_URL/app"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$SERVER_URL/app"
    else echo "请在浏览器打开: $SERVER_URL/app"; fi
    ;;
  update)
    echo "正在更新 ash…"
    fetch_self
    echo "✅ ash 已更新到最新版本"
    ;;
  help|-h|--help) show_help ;;
  *) show_help; exit 1 ;;
esac
