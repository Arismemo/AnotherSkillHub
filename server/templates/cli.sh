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

# 技能目录内容指纹（不含 .ash，也不含运行脚本时生成的 __pycache__ / *.pyc 和 .DS_Store）：与服务端 install.sh 中的定义保持一致
ash_fingerprint() {
  (cd "$1" && find . -name __pycache__ -prune -o -type f ! -name .ash ! -name '*.pyc' ! -name .DS_Store -print | LC_ALL=C sort | while IFS= read -r f; do printf '%s\n' "$f"; cat "$f"; done) | cksum | awk '{print $1 "-" $2}'
}

meta() { sed -n "s/^$2=//p" "$1/.ash" 2>/dev/null | head -n 1; }

# 备份目录：每次一个新目录（与 install.sh 一致）
backup_path() {
  local base p n=1
  base="$HOME/.ash/backups/$1-$(date +%Y%m%d%H%M%S)"
  p="$base"
  while [ -e "$p" ]; do n=$((n + 1)); p="$base-$n"; done
  mkdir -p "$(dirname "$p")"
  echo "$p"
}

# 共享存储：ash 装的技能默认只在这里存一份，各 Agent 的技能目录里是指向它的符号链接（与 install.sh 一致）
STORE="${ASH_STORE:-$HOME/.ash/skills}"

# 目录是不是指向共享存储的链接
is_store_link() { [ -L "$1" ] && [ "$(readlink "$1")" = "$STORE/$(basename "$1")" ]; }

# 共享存储里的技能链接在哪些 Agent 目录（每行一个）
links_of() {
  local root
  agent_dirs | while IFS= read -r root; do
    if is_store_link "$root/$1"; then echo "$root"; fi
  done
}

# 本机 Agent 的技能目录（存在的才列）：hermes profiles > 常见目录
agent_dirs() {
  local d
  for d in "$HOME"/.hermes/profiles/*/skills "$HOME/.hermes/skills" "$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.dsh/skills"; do
    if [ -d "$d" ]; then echo "$d"; fi
  done | awk '!seen[$0]++'
}

# 可能存放技能的目录：--dir 指定时只看它；否则 共享存储 > ASH_SKILLS_DIR > 各 Agent 目录（去重）
skill_roots() {
  if [ -n "${1:-}" ]; then echo "$1"; return; fi
  {
    if [ -d "$STORE" ]; then echo "$STORE"; fi
    if [ -n "${ASH_SKILLS_DIR:-}" ]; then echo "$ASH_SKILLS_DIR"; fi
    agent_dirs
  } | awk '!seen[$0]++'
}

# 本机各个 Agent 加载技能的目录（与服务端生成的多 Agent 安装脚本共用一份定义）
__AGENT_ROOTS_FN__

# 某个目录是哪个 Agent 在加载；没有 Agent 从这里加载时输出空
root_agent() {
  case "$1" in
    "$HOME/.claude/skills") echo "Claude Code" ;;
    "$HOME/.agents/skills") echo "Codex" ;;
    "$HOME/.hermes/skills"|"$HOME"/.hermes/profiles/*/skills) echo "Hermes" ;;
    "$HOME/.dsh/skills") echo "dsh" ;;
    */.claude/skills) echo "Claude Code（项目）" ;;
    */.agents/skills) echo "Codex（项目）" ;;
    *) echo "" ;;
  esac
}

# 已装技能引用的技能（每行一个 slug 或 slug@版本，跨账号的 @owner/slug 不算）。
# 新装的技能记在 .ash 的 deps 里；更早装的从 SKILL.md 的 depends_on: [a, b] 读
deps_of() {
  local dir="$1" deps
  if grep -q '^deps=' "$dir/.ash" 2>/dev/null; then deps="$(meta "$dir" deps)"
  else deps="$(sed -n '1,/^---$/s/^depends_on: *\[\(.*\)\].*/\1/p' "$dir/SKILL.md" 2>/dev/null | tr -d " \"'")"; fi
  printf '%s\n' "$deps" | tr ',' '\n' | while IFS= read -r spec; do
    case "$spec" in ''|@*) continue ;; esac
    echo "$spec"
  done
}

# 引用了、但同一目录里没有的技能：本地 Agent 顺着 ../<slug>/SKILL.md 找不到它
missing_deps() {
  local dir="$1" root spec
  root="$(dirname "$dir")"
  deps_of "$dir" | while IFS= read -r spec; do
    if [ ! -f "$root/${spec%%@*}/SKILL.md" ]; then echo "$spec"; fi
  done
}

# 已由 ash 安装的技能目录（含 .ash 元数据），每行一个目录。指向共享存储的链接不重复列（存储里那份就是它）
installed_dirs() {
  local root f d
  skill_roots "${1:-}" | while IFS= read -r root; do
    for f in "$root"/*/.ash; do
      [ -f "$f" ] || continue
      d="$(dirname "$f")"
      if [ -L "$d" ]; then continue; fi
      echo "$d"
    done
  done
}

# 用重装更新一个已装技能：共享存储里的装回存储、保持原来的链接；直接装在某个目录里的装回那个目录
reinstall() {
  local d="$1" slug="$2"; shift 2
  if [ "$(dirname "$d")" = "$STORE" ]; then
    ASH_LINK_ROOTS="$(links_of "$slug")"
    [ -n "$ASH_LINK_ROOTS" ] || ASH_LINK_ROOTS="-"
    ASH_LINK_ROOTS="$ASH_LINK_ROOTS" run_install "$SERVER_URL/s/$slug/install.sh" "$@"
  else
    ASH_SKILLS_DIR="$(dirname "$d")" run_install "$SERVER_URL/s/$slug/install.sh" "$@"
  fi
}

# 批量查询服务端状态：每行 slug<TAB>状态<TAB>修订<TAB>版本
fetch_revisions() {
  local args=(-X POST) dir
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
  # 固定版本的技能不跟着库里更新走：ash pull --all 跳过，ash outdated 不列
  if [ -n "$(meta "$dir" pinned)" ]; then
    if [ "$modified" = 1 ]; then printf 'modified\t固定在 v%s · 本地有修改\n' "$(meta "$dir" pinned)"
    else printf 'pinned\t固定在 v%s（库里当前 v%s）\n' "$(meta "$dir" pinned)" "$rver"; fi
    return
  fi
  case "$rstatus" in
    moved) printf 'moved\t已改名为 %s（ash migrate 换成新名）\n' "$(printf '%s' "$line" | cut -f5)"; return ;;
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
  local src="$1" bin_dir="${ASH_BIN_DIR:-}" use_sudo="" current
  current="$(command -v ash 2>/dev/null || true)"
  if [ -z "$bin_dir" ]; then
    if [ -n "$current" ] && [ -w "$(dirname "$current")" ]; then bin_dir="$(dirname "$current")"
    # 目录不可写、但 ash 文件本身可写（常见：root 建的 /usr/local/bin 里放着本人的 ash）：原地覆盖。
    # 否则会在别处另装一份，而 PATH 里更靠前的旧版本永远不会被替换
    elif [ -n "$current" ] && [ -f "$current" ] && [ -w "$current" ]; then
      cat "$src" > "$current" && rm -f "$src"
      echo "✓ 已更新 $current"
      return
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
  hash -r 2>/dev/null || true
  current="$(command -v ash 2>/dev/null || true)"
  if [ -n "$current" ] && [ "$current" != "$bin_dir/ash" ]; then
    echo "⚠️  PATH 里更靠前的 $current 不是刚安装的版本，运行 ash 仍会用到它：请删除它，或把 $bin_dir 放到 PATH 更前面"
  fi
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

给 Agent 的规则（4–7 条由 ash lint 和推送检查核对）
  1. 接到任务先 ash suggest "<任务>"；有现成技能就按它做，不要另写一份
  2. 写或改技能前读规范：ash show meta-skill-spec（元技能怎么引用、什么时候抽、description 怎么写）
  3. 新技能用 ash new <slug> 生成骨架；推送前 ash lint <目录或slug> 修到没有 ⚠️
  4. depends_on 只列做事时真要读或要跑的技能；「不要用于…（交给 X）」这类边界只写在 description 和正文
  5. 已有元技能负责的动作写一行「用元技能 \`<slug>\`」+ 本技能特有参数，不要抄它的步骤
  6. 中文为主：description 用中文写「做什么 + 什么时候用 + 不要用于…（交给 X）」，末尾加一句英文 Use when …
  7. 不写口令、token、内网地址、个人路径：写变量名，值放 ~/.comate/secrets/creds.env
  8. 改完 ash push <目录> --update 交回库里；用完技能 ash feedback <slug> ok|fail
  详细说明：ash guide

查找
  ash suggest "<任务描述>" [--limit N] [--json]           按任务描述找相关技能（接到任务时先用它）
  ash search <关键词…> [--tag T] [--folder F] [--json]   搜索已发布技能（多个关键词需同时命中；都不命中时给出相关候选）
  ash list [--tag T] [--folder F] [--json]               列出已发布技能
  ash info <slug>                 描述、依赖、文件清单、版本与安装命令
  ash show <slug>[@版本] [--version ID] [--pending]       直接输出 SKILL.md（不安装）；@版本 取那一版
  ash versions <slug>             历史版本列表
  ash lint [slug|技能目录] [--only CODE] [--all] [--json]  技能检查：写作约定、双语描述、引用、元技能契约、重复的步骤、能否被 Agent 调用
                                  传本地目录时检查还没推送的版本；不带参数检查全库（默认只列 ⚠️，--all 连写作风格提示一起列）

技能组合
  ash bundles [--json]            列出全部组合
  ash bundle <标识或名称>          查看组合成员

安装与本地管理
  ash pull <slug>[@版本] [--agent claude|codex|hermes|dsh|all] [--dir PATH] [--pending] [--force] [--no-deps]
                                  安装技能及其依赖：只在 ~/.ash/skills 存一份，再链接进本机每个 Agent 的技能目录
                                  （--agent 只链接给那个 Agent；--dir 直接装进指定目录、不建链接）；
                                  本地改过的同名目录先备份到 ~/.ash/backups（--force 不备份）；slug@1.2.0 安装那一版并固定
  ash pull bundle:<标识或名称>     一次安装整个技能组合
  ash pull --all [--dir PATH] [--force]   更新所有过期的已装技能（本地改过的跳过，除非 --force）
  ash installed [--dir PATH]      本机已装技能及状态（最新 / 有更新 / 本地有修改 / 远端已删除）
  ash outdated [--dir PATH]       只列出需要处理的已装技能
  ash remove <slug> [--dir PATH] [--force] 卸载；本地改过的先备份（--force 直接删除）
  ash doctor [--fix] [--dir PATH]  检查本机各 Agent 能不能用上已装的技能：引用的技能在不在旁边、装的目录有没有 Agent 加载；--fix 自动补装
  ash migrate [--apply] [--keep-copies]  把本机已有的技能换成共享存储 + 链接：ash 装的搬进存储，旧名换新名，
                                  和库里同名的手动副本先备份再换成库里的版本；默认只列计划

反馈
  ash feedback <slug> ok|fail ["说明"] [--dir PATH]   用完技能后回报结果；失败时写一句哪一步、为什么没走通

推送与审核
  ash new <slug> [--meta] [--dir PATH]  生成符合规范的技能骨架（frontmatter、description 模板；--meta 带契约与被谁引用两节）
  ash push <技能目录|SKILL.md> [--update] [--folder PATH] [--json]
                                  同名技能已存在时需加 --update；推送内容需人工审核后对其他 Agent 可见；结果里会附上检查意见
  ash mine                        我（本机）推送的技能及审核状态
  ash withdraw <slug>             撤回自己尚在待审核的推送

账号
  ash login [--token TOKEN]       登录：输入用户名密码换取 token，或直接保存网页「账户」里创建的 token
  ash whoami                      当前登录的账号
  ash logout                      删除本机保存的 token（要让它彻底失效，请在网页「账户」里吊销）

其它
  ash guide                       Agent 使用指南（规则的完整说明）
  ash open                        在浏览器打开管理后台
  ash update                      更新 ash 自身
  ash <命令> --help               只看这条命令的用法

完整文档：$SERVER_URL/docs
环境变量：ASH_AGENT 默认安装到哪个 Agent（claude|codex|hermes|dsh|all）；ASH_SERVER_URL 服务地址；ASH_TOKEN API token（默认读 ~/.ash/token）；ASH_STORE 共享存储目录（默认 ~/.ash/skills）；ASH_SKILLS_DIR 不用共享存储、直接装进这个目录；ASH_BIN_DIR ash 安装位置；ASH_TERMINAL 推送来源名（默认 hostname）
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

# ash <命令> --help：只打印这条命令的用法（取自总帮助），再附上给 Agent 的规则
for a in "$@"; do
  case "$a" in
    --help|-h)
      if [ "$cmd" != help ] && [ "$cmd" != -h ] && [ "$cmd" != --help ]; then
        show_help | awk -v c="  ash $cmd" '
          index($0, c" ") == 1 || $0 == c { on = 1; print; next }
          on && /^                                  / { print; next }
          { on = 0 }'
        echo
        show_help | sed -n '/^给 Agent 的规则/,/^  详细说明/p'
        exit 0
      fi ;;
  esac
done

case "$cmd" in
  pull)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)、组合 (bundle:<标识或名称>) 或 --all"
    target="$1"; shift
    args=(); dir=""; force=0; agent=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --agent) [ -n "${2:-}" ] || die "--agent 需要参数"; agent="$2"; args+=(--data-urlencode "agent=$2"); shift 2 ;;
        --dir) [ -n "${2:-}" ] || die "--dir 需要参数"; dir="$2"; args+=(--data-urlencode "dir=$2"); shift 2 ;;
        --pending) args+=(--data-urlencode "pending=1"); shift ;;
        --force) force=1; args+=(--data-urlencode "force=1"); shift ;;
        --no-deps) args+=(--data-urlencode "nodeps=1"); shift ;;
        *) die "未知参数: $1" ;;
      esac
    done
    # 没指定 --agent / --dir / ASH_SKILLS_DIR 时用 ASH_AGENT（例如 all：一台机器上同时用 Claude Code、Codex、Hermes）。
    # ash pull --all 更新时总是装回原来的目录，不受它影响
    if [ -z "$agent" ] && [ -z "$dir" ] && [ -z "${ASH_SKILLS_DIR:-}" ] && [ -n "${ASH_AGENT:-}" ] && [ "$target" != "--all" ]; then
      args+=(--data-urlencode "agent=$ASH_AGENT")
    fi
    if [ "$target" = "--all" ]; then
      dirs="$(installed_dirs "$dir")"
      [ -n "$dirs" ] || { echo "本机没有通过 ash 安装的技能"; exit 0; }
      revs="$(printf '%s\n' "$dirs" | fetch_revisions)"
      updated=0; skipped=0; failed=0
      while IFS= read -r d; do
        slug="$(meta "$d" slug)"
        state="$(skill_state "$d" "$revs")"; code="${state%%$'\t'*}"; note="${state#*$'\t'}"
        extra=(--data-urlencode "reason=update")
        if [ "$force" = 1 ]; then extra+=(--data-urlencode "force=1"); fi
        if [ "$(meta "$d" pending)" = 1 ]; then extra+=(--data-urlencode "pending=1"); fi
        case "$code" in
          outdated) ;;
          modified-outdated)
            if [ "$force" != 1 ]; then echo "⏭  ${slug}：${note}，跳过（ash pull $slug 会先备份再覆盖，或加 --force）"; skipped=$((skipped + 1)); continue; fi ;;
          missing|trashed|moved) echo "⚠️  ${slug}：$note"; continue ;;
          *) continue ;;
        esac
        # 装回原来的位置
        if reinstall "$d" "$slug" "${extra[@]}"; then updated=$((updated + 1)); else failed=$((failed + 1)); fi
      done <<EOF
$dirs
EOF
      echo "完成：更新 $updated 个，跳过 $skipped 个，失败 $failed 个"
      [ "$failed" = 0 ] || exit 1
    elif [ "${target#bundle:}" != "$target" ]; then
      run_install "$SERVER_URL/s/bundle/$(urlencode "${target#bundle:}")/install.sh" "${args[@]+"${args[@]}"}"
    else
      # slug@1.2.0：安装历史里的那一版，并记为固定版本
      case "$target" in *@*) args+=(--data-urlencode "pin=${target#*@}"); target="${target%%@*}" ;; esac
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
      if [ "$cmd" = "outdated" ] && { [ "$code" = "ok" ] || [ "$code" = "pinned" ]; }; then continue; fi
      printf '%s  ·  v%s  ·  %s  ·  %s\n' "$(meta "$d" slug)" "$(meta "$d" version)" "$note" "$d"
      if [ "$(dirname "$d")" = "$STORE" ]; then
        linked="$(links_of "$(meta "$d" slug)" | while IFS= read -r r; do printf '%s ' "$(root_agent "$r")"; done)"
        if [ -n "$linked" ]; then printf '   ↳ 链接给：%s\n' "$linked"; else printf '   ↳ 没有链接给任何 Agent（ash pull %s --agent <agent> 链接过去）\n' "$(meta "$d" slug)"; fi
      fi
      miss="$(missing_deps "$d" | tr '\n' ' ')"
      if [ -n "${miss// /}" ]; then printf '   ↳ 引用的技能不在旁边：%s（ash doctor --fix 补装）\n' "$miss"; fi
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
      # 共享存储里的技能：先拆掉各 Agent 目录里指向它的链接
      if [ "$(dirname "$d")" = "$STORE" ]; then
        while IFS= read -r r; do
          if [ -n "$r" ]; then rm -f "$r/$slug"; echo "✓ 已移除链接 $r/$slug"; fi
        done <<EOF2
$(links_of "$slug")
EOF2
      fi
      if [ "$force" != 1 ] && [ "$(meta "$d" fingerprint)" != "$(ash_fingerprint "$d")" ]; then
        backup="$(backup_path "$slug")"
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
  migrate)
    # 把本机已有的技能换成「共享存储 + 链接」：
    #   1. ash 装在 Agent 目录里的技能 → 搬进共享存储，原位置换成链接
    #   2. 已改名 / 合并的旧名 → 换成新名（旧目录先备份）
    #   3. 和库里同名、但不是 ash 装的手动副本 → 先备份到 ~/.ash/backups，再换成库里的版本（--keep-copies 不动它们）
    # 嵌在 Agent 分类子目录里的同名副本（如 ~/.hermes/skills/devops/<slug>）也算副本。默认只列计划，--apply 才执行
    apply=0; keep=0
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --apply) apply=1; shift ;;
        --keep-copies) keep=1; shift ;;
        *) die "未知参数: $1" ;;
      esac
    done
    # 库里所有技能（含废纸篓、改名去向）一次查回：每行 slug<TAB>状态<TAB>修订<TAB>版本[<TAB>新标识符]
    cands="$(
      agent_dirs | while IFS= read -r root; do
        for d in "$root"/* "$root"/*/*; do
          [ -f "$d/SKILL.md" ] || continue
          # 链接本身（ash 建的或别的工具建的）和链接目录里面的东西都不是本机副本
          if [ -L "$d" ] || [ -L "$(dirname "$d")" ]; then continue; fi
          # 技能自己的子目录（例如带 SKILL.md 的模板）不是另一个技能
          if [ "$(dirname "$d")" != "$root" ] && [ -f "$(dirname "$d")/SKILL.md" ]; then continue; fi
          echo "$d"
        done
      done
    )"
    # 共享存储里已改名的旧技能（链接上面跳过了，这里按存储里的那份算）
    if [ -d "$STORE" ]; then
      for d in "$STORE"/*; do
        if [ -f "$d/.ash" ] && [ ! -L "$d" ]; then cands="${cands:+$cands
}$d"; fi
      done
    fi
    [ -n "$cands" ] || { echo "本机 Agent 目录里没有技能"; exit 0; }
    revs="$(printf '%s\n' "$cands" | while IFS= read -r d; do
      if [ -f "$d/.ash" ]; then meta "$d" slug; else basename "$d"; fi
    done | awk '!seen[$0]++' | { args=(-X POST); while IFS= read -r x; do args+=(--data-urlencode "slug=$x"); done; http "${args[@]}" "$SERVER_URL/api/agent/revisions"; })"
    plan=""; n=0
    while IFS= read -r d; do
      [ -n "$d" ] || continue
      root="$(dirname "$d")"; name="$(basename "$d")"
      if [ -f "$d/.ash" ]; then slug="$(meta "$d" slug)"; else slug="$name"; fi
      line="$(printf '%s\n' "$revs" | awk -F'\t' -v s="$slug" '$1 == s { print; exit }')"
      st="$(printf '%s' "$line" | cut -f2)"
      target="$slug"
      case "$st" in
        published|pending) ;;
        moved) target="$(printf '%s' "$line" | cut -f5)" ;;
        *) continue ;; # 库里没有（Agent 自带或自己写的技能）、或已删除：不动
      esac
      if [ "$root" = "$STORE" ]; then
        # 存储里的技能只处理改名：每个链接到它的 Agent 目录都换成新名
        [ "$target" != "$slug" ] || continue
        while IFS= read -r r; do
          [ -n "$r" ] || continue
          plan="${plan}rename	${d}	${target}	${r}
"
          n=$((n + 1))
        done <<EOF2
$(links_of "$slug")
EOF2
        plan="${plan}drop	${d}	${target}	-
"
        continue
      fi
      # 分类子目录里的副本：链接放到 Agent 目录顶层（Agent 按目录树扫描，放哪层都能加载）
      case "$root" in */skills) link_root="$root" ;; *) link_root="$(dirname "$root")" ;; esac
      if [ -f "$d/.ash" ] && [ "$target" = "$slug" ] && [ "$root" = "$link_root" ]; then kind="move"
      elif [ -f "$d/.ash" ] || [ "$target" != "$slug" ]; then kind="replace"
      else
        kind="copy"
        if [ "$keep" = 1 ]; then continue; fi
      fi
      plan="${plan}${kind}	${d}	${target}	${link_root}
"
      n=$((n + 1))
    done <<EOF
$cands
EOF
    [ "$n" -gt 0 ] || { echo "✅ 没有需要迁移的技能（共享存储: $STORE）"; exit 0; }
    echo "共享存储: $STORE（各 Agent 目录里放指向它的链接）"
    printf '%s' "$plan" | while IFS="$(printf '\t')" read -r kind d target link_root; do
      [ -n "$kind" ] || continue
      case "$kind" in
        move) echo "  搬进存储  $d" ;;
        replace) echo "  换成新版  $d → $target（旧目录备份）" ;;
        copy) echo "  替换副本  $d → 库里的 $target（副本备份）" ;;
        rename) echo "  换成新名  $link_root/$(basename "$d") → $target" ;;
        drop) ;;
      esac
    done
    if [ "$apply" != 1 ]; then echo "共 $n 项。确认后运行 ash migrate --apply 执行（手动副本会先备份到 ~/.ash/backups；--keep-copies 不动手动副本）"; exit 0; fi
    mkdir -p "$STORE"
    failed=0
    while IFS="$(printf '\t')" read -r kind d target link_root; do
      [ -n "$kind" ] || continue
      if [ "$kind" = drop ]; then
        # 改名的旧技能：各处链接已换成新名，存储里的旧目录收进备份
        if [ -d "$d" ]; then backup="$(backup_path "$(basename "$d")")"; mv "$d" "$backup"; echo "↳ 已备份 $d → $backup"; fi
        continue
      fi
      if [ "$kind" = rename ]; then
        rm -f "$link_root/$(basename "$d")"
        d="$link_root/$(basename "$d")"
      fi
      if [ "$kind" = move ] && [ ! -e "$STORE/$target" ]; then
        # 原样搬过去（保留 .ash 与本地修改），原位置换成链接
        mv "$d" "$STORE/$target"
        ln -s "$STORE/$target" "$d"
        echo "✓ $d → 链接到 $STORE/$target"
        continue
      fi
      if [ -e "$d" ] && [ ! -L "$d" ]; then
        backup="$(backup_path "$(basename "$d")")"
        mv "$d" "$backup"
        echo "↳ 已备份 $d → $backup"
      fi
      # 同一技能已在存储里（别的 Agent 迁移过）就只补链接，否则装进存储并链接到这个 Agent 目录
      if [ -f "$STORE/$target/.ash" ]; then
        if [ ! -e "$link_root/$target" ]; then ln -s "$STORE/$target" "$link_root/$target"; fi
        echo "✓ $link_root/$target → 链接到 $STORE/$target"
      elif ! ASH_LINK_ROOTS="$link_root" run_install "$SERVER_URL/s/$target/install.sh" --data-urlencode "reason=update" >/dev/null; then
        echo "✗ $target 安装失败（备份仍在 ~/.ash/backups）"; failed=$((failed + 1))
      else
        echo "✓ $link_root/$target → 链接到 $STORE/$target"
      fi
    done <<EOF
$plan
EOF
    echo "完成。ash doctor 检查引用是否都链接齐了（ash doctor --fix 自动补）"
    [ "$failed" = 0 ] || exit 1
    ;;
  doctor)
    fix=0; dir=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --fix) fix=1; shift ;;
        --dir) [ -n "${2:-}" ] || die "--dir 需要参数"; dir="$2"; shift 2 ;;
        *) die "未知参数: $1" ;;
      esac
    done
    problems=0; total=0; fixed_any=0
    while IFS= read -r root; do
      [ -n "$root" ] || continue
      n=0
      for f in "$root"/*/.ash; do if [ -f "$f" ] && [ ! -L "$(dirname "$f")" ]; then n=$((n + 1)); fi; done
      [ "$n" -gt 0 ] || continue
      if [ "$root" = "$STORE" ]; then who="共享存储，经链接给各 Agent"; else who="$(root_agent "$root")"; fi
      echo "$root（${who:-没有 Agent 从这里加载}）：$n 个 ash 安装的技能"
      if [ -z "$who" ]; then echo "  ⚠️  没有 Agent 会从这个目录加载技能：ash pull <slug> --agent <agent|all> 装到 Agent 的目录"; problems=$((problems + 1)); fi
      for f in "$root"/*/.ash; do
        [ -f "$f" ] || continue
        d="$(dirname "$f")"
        if [ -L "$d" ]; then continue; fi
        slug="$(meta "$d" slug)"; total=$((total + 1))
        links=""
        if [ "$root" = "$STORE" ]; then
          links="$(links_of "$slug")"
          if [ -z "$links" ]; then echo "  ⚠️  $slug 没有链接给任何 Agent：ash pull $slug --agent <claude|codex|hermes|dsh|all>"; problems=$((problems + 1)); fi
        fi
        while IFS= read -r spec; do
          [ -n "$spec" ] || continue
          dep="${spec%%@*}"
          if [ -f "$root/$dep/SKILL.md" ]; then
            if sed -n '1,/^---$/p' "$root/$dep/SKILL.md" | grep -qiE '^disable-model-invocation: *(true|yes|on|1)'; then
              echo "  ⚠️  $slug 引用的 $dep 设置了 disable-model-invocation：Claude Code 里调用不到它（仍可读 ../$dep/SKILL.md）"
              problems=$((problems + 1))
            fi
            # 共享存储：引用的技能要和它链接进同样的 Agent 目录，../<dep>/SKILL.md 才对得上
            while IFS= read -r r; do
              [ -n "$r" ] || continue
              if [ -e "$r/$dep" ]; then continue; fi
              if [ "$fix" = 1 ]; then ln -s "$STORE/$dep" "$r/$dep"; fixed_any=1; echo "  ✓ 已把 $dep 链接进 ${r}（$slug 引用它）"
              else echo "  ✗ $slug 引用的 $dep 没有链接进 ${r}（ash doctor --fix 补上）"; problems=$((problems + 1)); fi
            done <<EOF3
$links
EOF3
            continue
          fi
          if [ "$fix" = 1 ]; then
            extra=(--data-urlencode "reason=dependency")
            case "$spec" in *@*) extra+=(--data-urlencode "pin=${spec#*@}") ;; esac
            fixed=0
            if [ "$root" = "$STORE" ]; then
              if ASH_LINK_ROOTS="${links:--}" run_install "$SERVER_URL/s/$dep/install.sh" "${extra[@]}" >/dev/null 2>&1; then fixed=1; fi
            else
              if ASH_SKILLS_DIR="$root" run_install "$SERVER_URL/s/$dep/install.sh" "${extra[@]}" >/dev/null 2>&1; then fixed=1; fi
            fi
            if [ "$fixed" = 1 ]; then
              fixed_any=1
              echo "  ✓ 已把 $slug 引用的 $dep 装到旁边"
            else
              echo "  ✗ $slug 引用的 $dep 安装失败（库里没有、未发布或网络错误）"; problems=$((problems + 1))
            fi
          else
            echo "  ✗ $slug 引用的 $dep 不在同一目录，本地 Agent 找不到它（ash doctor --fix 自动补装）"; problems=$((problems + 1))
          fi
        done <<EOF2
$(deps_of "$d")
EOF2
      done
    done <<EOF
$(skill_roots "$dir")
EOF
    if [ "$total" = 0 ]; then echo "本机没有通过 ash 安装的技能"; exit 0; fi
    # 补上的链接会让排在前面、已检查过的技能多出 Agent 目录，它们的引用也要跟着补：
    # 这一轮补过东西就再跑一轮，直到没有可补的（最多 5 轮，防止意外死循环）
    if [ "$fix" = 1 ] && [ "$fixed_any" = 1 ] && [ "${ASH_DOCTOR_PASS:-1}" -lt 5 ]; then
      echo "↻ 补上的链接带出了新的引用，再检查一轮"
      ASH_DOCTOR_PASS=$(( ${ASH_DOCTOR_PASS:-1} + 1 )) exec bash "$0" doctor --fix ${dir:+--dir "$dir"}
    fi
    # 当前在 Claude Code 里，技能却都装在别的 Agent 的目录：Claude Code 看不到它们
    if [ "${CLAUDECODE:-}" = "1" ] && [ -z "$dir" ] && ! ls "$HOME"/.claude/skills/*/.ash >/dev/null 2>&1; then
      echo "⚠️  当前在 Claude Code 里，但 ~/.claude/skills 没有 ash 装的技能：Claude Code 只从那里加载（ash pull <slug> --agent claude，或 --agent all）"
      problems=$((problems + 1))
    fi
    if [ "$problems" = 0 ]; then echo "✅ 没有发现问题"; else echo "发现 $problems 个问题"; exit 1; fi
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
  suggest)
    args=(-G); json=0; words=()
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --json) json=1; shift ;;
        --limit) [ -n "${2:-}" ] || die "--limit 需要参数"; args+=(--data-urlencode "limit=$2"); shift 2 ;;
        *) words+=("$1"); shift ;;
      esac
    done
    [ "${#words[@]}" -gt 0 ] || die '请描述要做的任务，例如 ash suggest "把感知回放结果叠到原图上验证"'
    if [ "$json" = 0 ]; then args+=(--data-urlencode "format=text"); fi
    http "${args[@]}" --data-urlencode "q=${words[*]}" "$SERVER_URL/api/agent/suggest"
    ;;
  feedback)
    [ -n "${1:-}" ] && [ -n "${2:-}" ] || die '用法: ash feedback <slug> ok|fail ["说明"]'
    slug="$1"; outcome="$2"; shift 2; valid_slug "$slug"
    case "$outcome" in ok|fail) ;; *) die "结果只能是 ok 或 fail" ;; esac
    dir=""; note=()
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --dir) [ -n "${2:-}" ] || die "--dir 需要参数"; dir="$2"; shift 2 ;;
        *) note+=("$1"); shift ;;
      esac
    done
    # 反馈对应本机已装的版本：从 .ash 取修订号（没装过、只用 ash show 读过时由服务端按当前版本算）
    revision=""
    while IFS= read -r d; do
      [ -n "$d" ] || continue
      if [ "$(meta "$d" slug)" = "$slug" ]; then revision="$(meta "$d" revision)"; break; fi
    done <<EOF
$(installed_dirs "$dir")
EOF
    http -X POST --data-urlencode "slug=$slug" --data-urlencode "outcome=$outcome" --data-urlencode "note=${note[*]+"${note[*]}"}" \
      --data-urlencode "revision=$revision" --data-urlencode "terminal=$TERMINAL" "$SERVER_URL/api/agent/feedback"
    ;;
  info)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)"; valid_slug "$1"
    http "$SERVER_URL/s/$1/info"
    ;;
  show)
    [ -n "${1:-}" ] || die "请提供技能标识 (slug)"; slug="$1"; shift
    args=(-G --data-urlencode "terminal=$TERMINAL")
    case "$slug" in *@*) args+=(--data-urlencode "pin=${slug#*@}"); slug="${slug%%@*}" ;; esac
    valid_slug "$slug"
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
  lint)
    args=(-G); json=0; local_file=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --json) json=1; shift ;;
        --only) [ -n "${2:-}" ] || die "--only 需要参数（例如 bilingual）"; args+=(--data-urlencode "code=$2"); shift 2 ;;
        --all) args+=(--data-urlencode "all=1"); shift ;;
        -*) die "未知参数: $1" ;;
        *)
          # 本地目录或 SKILL.md：检查还没推送的版本
          if [ -d "$1" ] && [ -f "$1/SKILL.md" ]; then local_file="$1/SKILL.md"
          elif [ -f "$1" ]; then local_file="$1"
          else valid_slug "$1"; args+=(--data-urlencode "slug=$1"); fi
          shift ;;
      esac
    done
    if [ -n "$local_file" ]; then
      form=(-X POST --data-urlencode "content@$local_file")
      for a in "${args[@]}"; do case "$a" in code=*) form+=(--data-urlencode "$a") ;; esac; done
      if [ "$json" = 0 ]; then form+=(--data-urlencode "format=text"); fi
      http "${form[@]}" "$SERVER_URL/api/agent/lint"
    else
      if [ "$json" = 0 ]; then args+=(--data-urlencode "format=text"); fi
      http "${args[@]}" "$SERVER_URL/api/agent/lint"
    fi
    ;;
  new)
    [ -n "${1:-}" ] || die "用法: ash new <slug> [--meta] [--dir PATH]"
    slug="$1"; shift; meta=0; dir="."
    [[ "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "slug 只能用小写字母、数字和单个连字符（例如 dthorx-log-pull）"
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --meta) meta=1; shift ;;
        --dir) [ -n "${2:-}" ] || die "--dir 需要参数"; dir="$2"; shift 2 ;;
        *) die "未知参数: $1" ;;
      esac
    done
    target="$dir/$slug"
    [ ! -e "$target" ] || die "$target 已存在"
    if http -G --data-urlencode "slug=$slug" "$SERVER_URL/api/agent/revisions" | grep -q $'\t\\(published\\|pending\\)\t'; then
      die "库里已有 ${slug}：先 ash pull $slug 在原版上改，再 ash push --update"
    fi
    mkdir -p "$target"
    if [ "$meta" = 1 ]; then
      prefix="【元技能】"; extra='
## 契约

- 输入：调用方要给什么
- 输出：调用方拿回什么
- 前置：需要什么环境
- 失败：失败时返回什么、调用方该怎么办

## 陷阱

（这个动作特有的坑，全库只在这里写）

## 被谁引用

| 技能 | 用途 |
|---|---|
'
    else
      prefix=""; extra='
## 验证

怎样确认完成、常见失败怎么处理。需要判定证据是否足够时引用验收纪律的元技能，并把它加进 depends_on（ash suggest "验收 证据" 能找到）。
'
    fi
    cat > "$target/SKILL.md" <<EOF2
---
name: $slug
description: ${prefix}<中文：做什么>。用户说「<触发说法>」时使用。不要用于<相近但不归本技能的事>（交给 <slug>）。Use when <English trigger>.
version: 1.0.0
tags: []
# depends_on: [<做事时真要读或要跑的技能>]   只列流程里用到的；「交给 X」这类边界不列
---

# <人读标题>

## 何时使用

## 步骤

1. 具体、可执行的命令或操作。已有元技能负责的动作只写一行引用它的 slug，加上本技能特有参数，不要抄它的步骤
${extra}
EOF2
    echo "✓ 已生成 $target/SKILL.md"
    echo "  写完后：ash lint $target    （修到没有 ⚠️）"
    echo "  推送：  ash push $target"
    echo "  规范：  ash show meta-skill-spec"
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
    # 本文件可能刚被原地改写：立即退出，别让 bash 从改写后的文件里接着读
    exit 0
    ;;
  help|-h|--help) show_help ;;
  *) show_help; exit 1 ;;
esac
