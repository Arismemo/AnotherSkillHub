#!/usr/bin/env bash
# ash — AnotherSkillHub CLI（由服务端 /cli.sh 生成；`ash update` 更新到服务端最新版）
set -euo pipefail

DEFAULT_SERVER_URL=__SERVER_URL__
SERVER_URL="${ASH_SERVER_URL:-$DEFAULT_SERVER_URL}"
SERVER_URL="${SERVER_URL%/}"

die() { echo "错误: $*" >&2; exit 1; }

# 调用接口：成功时输出响应体；HTTP ≥400 时把服务端返回的错误信息输出到 stderr 并返回非零
http() {
  local out code body
  out=$(curl -sS -w '\n%{http_code}' "$@") || die "无法连接 $SERVER_URL"
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
  body="${body%$'\n'}"
  if [ "$code" -ge 400 ] 2>/dev/null; then
    printf '%s\n' "$body" >&2
    return 1
  fi
  printf '%s\n' "$body"
}

valid_slug() { [[ "$1" =~ ^[A-Za-z0-9_.-]+$ ]] || die "非法的技能标识符: $1"; }

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
  echo "🚀 正在安装 AnotherSkillHub 命令行工具 ash（服务: $SERVER_URL）"
  fetch_self
  echo "✅ 安装完成。Agent 使用说明：ash guide"
  exit 0
fi

show_help() {
  cat <<EOF
AnotherSkillHub CLI · 服务地址: $SERVER_URL

查找
  ash search <关键词>            搜索技能（名称/描述/正文），--json 输出原始 JSON
  ash list                      列出全部已发布技能，--json 输出原始 JSON
  ash info <slug>               查看技能描述、文件清单、版本与安装命令
  ash show <slug>               直接输出 SKILL.md（不安装）

安装
  ash pull <slug> [--agent claude|codex|hermes|dsh] [--dir PATH] [--pending]
  ash pull bundle:<组合标识>     一次安装整个技能组合

推送
  ash push <技能目录|SKILL.md> [--update] [--folder PATH] [--json]
                                同名技能已存在时需加 --update；推送内容需人工审核后对其他 Agent 可见

其它
  ash guide                     Agent 使用指南（何时搜索/拉取/推送、SKILL.md 规范）
  ash open                      在浏览器打开管理后台
  ash update                    更新 ash 自身

环境变量：ASH_SERVER_URL 覆盖服务地址；ASH_SKILLS_DIR 指定默认安装目录；ASH_BIN_DIR 指定 ash 安装位置
EOF
}

cmd="${1:-help}"
[ "$#" -gt 0 ] && shift

case "$cmd" in
  pull)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug) 或组合 (bundle:<标识>)"
    target="$1"; shift
    args=(-G)
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --agent) [ -n "${2:-}" ] || die "--agent 需要参数"; args+=(--data-urlencode "agent=$2"); shift 2 ;;
        --dir) [ -n "${2:-}" ] || die "--dir 需要参数"; args+=(--data-urlencode "dir=$2"); shift 2 ;;
        --pending) args+=(--data-urlencode "pending=1"); shift ;;
        *) die "未知参数: $1" ;;
      esac
    done
    if [ "${target#bundle:}" != "$target" ]; then
      bundle="${target#bundle:}"; valid_slug "$bundle"
      url="$SERVER_URL/s/bundle/$bundle/install.sh"
    else
      valid_slug "$target"
      url="$SERVER_URL/s/$target/install.sh"
    fi
    # 服务端对不存在/待审核等情况也返回可执行脚本（输出原因并 exit 1），所以这里不看状态码
    script="$(curl -sS "${args[@]}" "$url")" || die "无法连接 $SERVER_URL"
    printf '%s\n' "$script" | bash
    ;;
  list)
    if [ "${1:-}" = "--json" ]; then http "$SERVER_URL/api/skills"
    else http -G --data-urlencode "format=text" "$SERVER_URL/api/skills"; fi
    ;;
  search)
    json=0; words=()
    for a in "$@"; do if [ "$a" = "--json" ]; then json=1; else words+=("$a"); fi; done
    [ "${#words[@]}" -gt 0 ] || die "请提供搜索关键词"
    kw="${words[*]}"
    if [ "$json" = 1 ]; then http -G --data-urlencode "search=$kw" "$SERVER_URL/api/skills"
    else http -G --data-urlencode "search=$kw" --data-urlencode "format=text" "$SERVER_URL/api/skills"; fi
    ;;
  info)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)"; valid_slug "$1"
    http "$SERVER_URL/s/$1/info"
    ;;
  show)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)"; valid_slug "$1"
    q=""; [ "${2:-}" = "--pending" ] && q="?pending=1"
    http -H 'Accept: text/markdown' "$SERVER_URL/s/$1.md$q"
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
    host="$(hostname 2>/dev/null || echo Unknown-Host)"
    form=(-F "terminal=$host" -F "update=$update")
    [ -n "$folder" ] && form+=(-F "folder=$folder")
    [ "$json" = 0 ] && form+=(-F "format=text")
    if [ -d "$target" ]; then
      [ -f "$target/SKILL.md" ] || die "目录中缺少 SKILL.md：$target"
      archive="$(mktemp "${TMPDIR:-/tmp}/ash-push.XXXXXX")"
      trap 'rm -f "$archive"' EXIT
      COPYFILE_DISABLE=1 tar -czf "$archive" --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
        --exclude='.DS_Store' --exclude='._*' -C "$target" .
      nfiles="$(tar -tzf "$archive" | grep -vc '/$' || true)"
      echo "→ 推送目录 $target（$nfiles 个文件，来源 $host）" >&2
      http -X POST "$SERVER_URL/api/agent/push" -F "file=@$archive;filename=skill.tar.gz;type=application/gzip" "${form[@]}"
    else
      [ -f "$target" ] || die "找不到技能文件或目录: $target"
      echo "→ 推送文件 $target（来源 $host）" >&2
      http -X POST "$SERVER_URL/api/agent/push" -F "file=@$target" "${form[@]}"
    fi
    ;;
  guide)
    http "$SERVER_URL/agent.md"
    ;;
  open)
    if command -v open >/dev/null 2>&1; then open "$SERVER_URL"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$SERVER_URL"
    else echo "请在浏览器打开: $SERVER_URL"; fi
    ;;
  update)
    echo "正在更新 ash…"
    fetch_self
    echo "✅ ash 已更新到最新版本"
    ;;
  help|-h|--help) show_help ;;
  *) show_help; exit 1 ;;
esac
