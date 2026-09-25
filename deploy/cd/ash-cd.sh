#!/usr/bin/env bash
# ash-cd — seed-SER9 上的拉取式持续部署。
#
# systemd 定时器每 2 分钟执行一次 `ash-cd poll`：main 出现新提交、且它的 CI 检查（check、docker）
# 全部通过时，按部署手册的顺序上线：备份 DB 与技能文件 → 构建 ash:<sha> → 切换容器 → 冒烟。
# 冒烟失败自动切回上一个版本。部署进度回写到 GitHub Deployments（environment: production）。
#
# 用法：
#   ash-cd poll                 定时器入口；没有新的可部署提交时什么也不做
#   ash-cd deploy <sha>         立即部署某个提交（仍要求它的 CI 已通过；--force 跳过 CI 检查）
#   ash-cd rollback [<tag>]     切回上一个（或指定的）已发布版本
#   ash-cd status               当前版本、main 最新提交及其 CI 状态、最近的部署记录
#
# 只依赖本机的 docker、git、gh（已登录）、curl、flock。代码来自自己维护的镜像仓库，
# 与任何工作目录 / worktree 当前在哪个分支无关。
set -euo pipefail

REPO="${ASH_CD_REPO:-Arismemo/AnotherSkillHub}"
SERVICES="${ASH_CD_SERVICES:-$HOME/services}"
RELEASES="$SERVICES/skillhub-releases"
CD_HOME="${ASH_CD_HOME:-$SERVICES/skillhub-cd}"
MIRROR="$CD_HOME/repo.git"
STATE="$CD_HOME/state"
HISTORY="$CD_HOME/history.log"
LOCAL_URL="${ASH_CD_LOCAL_URL:-http://127.0.0.1:9444}"
# 以下三项只为在预发环境里演练 CD 时覆盖；生产保持默认
CONTAINER="${ASH_CD_CONTAINER:-ash}"   # 容器名
PROJECT="${ASH_CD_PROJECT:-ash}"       # docker compose -p
IMAGE="${ASH_CD_IMAGE:-ash}"           # 镜像仓库名，tag 为 7 位短 sha
GH_DEPLOYMENTS="${ASH_CD_GH_DEPLOYMENTS:-1}"  # 0 = 不写 GitHub Deployments（演练用）
PUBLIC_URL="${ASH_CD_PUBLIC_URL:-https://ash.709970.xyz}"
REQUIRED_CHECKS=(check docker)   # 与 .github/workflows/ci.yml 的 job 名一致
KEEP_IMAGES=10                   # 磁盘紧张：只保留最近 10 个 ash 镜像（当前版本永远保留）

mkdir -p "$CD_HOME" "$STATE"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

current_tag() { docker inspect "$CONTAINER" --format '{{.Config.Image}}' 2>/dev/null | sed "s#^$IMAGE:##"; }

# 在运行中的容器里数技能行数：部署前后应当一致（迁移不许丢数据）
db_count() {
  docker exec "$CONTAINER" node -e '
    const D = require("better-sqlite3");
    const db = new D("/app/data/another-skillhub.db", { readonly: true });
    console.log(db.prepare("SELECT COUNT(*) AS c FROM skills").get().c);'
}

sync_mirror() {
  if [ ! -d "$MIRROR" ]; then git clone -q --mirror "https://github.com/$REPO.git" "$MIRROR"; fi
  git -C "$MIRROR" fetch -q --prune origin
}

# 输出 success / failure / pending
ci_state() {
  local sha=$1 name result
  for name in "${REQUIRED_CHECKS[@]}"; do
    # 同名检查可能被重跑多次，取最近开始的那一次
    result=$(gh api "repos/$REPO/commits/$sha/check-runs?check_name=$name&per_page=100" \
      --jq '[.check_runs[]] | sort_by(.started_at) | last | if . == null then "missing" else "\(.status)/\(.conclusion)" end' 2>/dev/null) \
      || { echo pending; return; }
    case "$result" in
      completed/success) ;;
      completed/*) echo failure; return ;;
      *) echo pending; return ;;
    esac
  done
  echo success
}

# ——— GitHub Deployments（失败不影响部署本身）———
DEPLOY_ID=""
gh_deployment() {
  [ "$GH_DEPLOYMENTS" = 1 ] || return 0
  DEPLOY_ID=$(gh api -X POST "repos/$REPO/deployments" --jq .id --input - 2>/dev/null <<JSON || true
{"ref": "$1", "environment": "production", "auto_merge": false, "required_contexts": [],
 "description": "ash-cd on $(hostname)", "production_environment": true}
JSON
)
}
gh_status() {
  [ -n "$DEPLOY_ID" ] || return 0
  gh api -X POST "repos/$REPO/deployments/$DEPLOY_ID/statuses" \
    -f state="$1" -f description="$2" -f environment_url="$PUBLIC_URL" >/dev/null 2>&1 || true
}

wait_healthy() {
  local i
  for i in $(seq 1 45); do
    curl -fsS -m 3 "$LOCAL_URL/healthz" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

http_code() { curl -s -o /dev/null -m 10 -w '%{http_code}' "$1"; }

smoke() {
  local expected_count=$1 started=$2 count
  wait_healthy || { log "smoke: /healthz 90 秒内没有就绪"; return 1; }
  [ "$(http_code "$LOCAL_URL/")" = 200 ] || { log "smoke: 首页不是 200"; return 1; }
  [ "$(http_code "$LOCAL_URL/docs")" = 200 ] || { log "smoke: /docs 不是 200"; return 1; }
  [ "$(http_code "$LOCAL_URL/api/skills")" = 401 ] || { log "smoke: /api/skills 未登录没有返回 401"; return 1; }
  count=$(db_count) || { log "smoke: 读不出技能数"; return 1; }
  [ "$count" = "$expected_count" ] || { log "smoke: 技能数 $expected_count → $count"; return 1; }
  if docker logs --since "$started" "$CONTAINER" 2>&1 | grep -qiE '^migration:|unhandled|uncaught'; then
    log "smoke: 容器日志里有迁移或未捕获错误"; docker logs --since "$started" "$CONTAINER" 2>&1 | tail -20 >&2; return 1
  fi
  # 公网入口经过独立的隧道和网关，不通只告警、不回滚
  [ "$(http_code "$PUBLIC_URL/healthz")" = 200 ] || log "WARN: 公网 $PUBLIC_URL/healthz 不通，检查 skillhub-tunnel 服务"
  log "smoke ok：技能数 $count"
}

switch_to() {
  local tag=$1
  [ -f "$RELEASES/$tag/compose.deploy.yml" ] || die "找不到 $RELEASES/$tag/compose.deploy.yml"
  (cd "$RELEASES/$tag" && docker compose -p "$PROJECT" -f compose.deploy.yml up -d --no-build) >&2
}

prune_images() {
  local current; current=$(current_tag)
  docker images "$IMAGE" --format '{{.CreatedAt}}\t{{.Tag}}' | sort -r | cut -f2 \
    | { grep -vx "$current" || true; } | tail -n "+$KEEP_IMAGES" | while read -r tag; do
      docker rmi "$IMAGE:$tag" >/dev/null 2>&1 && log "清理旧镜像 $IMAGE:$tag" || true
    done
}

# 部署中途失败：回写 GitHub 状态并返回非零（调用方据此标记该提交，不再自动重试）
abort() { gh_status failure "$1"; log "ERROR: $1"; return 1; }

deploy() {
  local full=$1 sha=${1:0:7} old started before
  old=$(current_tag)
  [ -n "$old" ] || die "$CONTAINER 容器不存在；首次部署请按 docs/deploy.md 手动完成"
  if [ "$sha" = "$old" ]; then log "$IMAGE:$sha 已在线上"; return 0; fi
  [ -f "$RELEASES/$old/compose.deploy.yml" ] || die "当前版本 $old 没有发布目录，无法派生 compose"
  log "开始部署 $sha（当前 $old）"
  gh_deployment "$full"
  gh_status in_progress "building $IMAGE:$sha"

  # 1. 备份：DB 与技能文件（数据卷属 root，在容器里做）
  docker exec "$CONTAINER" node -e "new (require('better-sqlite3'))('/app/data/another-skillhub.db').backup('/app/data/backup-before-$sha.db').then(() => console.log('db backup ok'))" >&2 \
    || { abort "数据库备份失败"; return 1; }
  docker exec "$CONTAINER" tar -czf "/app/data/backup-files-before-$sha.tgz" -C /app/data skills_files \
    || { abort "技能文件备份失败"; return 1; }
  before=$(db_count) || { abort "读不出部署前的技能数"; return 1; }

  # 2. 源码 → 镜像（服务器 npm install 偶发网络抖动，失败重试一次）
  rm -rf "${RELEASES:?}/$sha" && mkdir -p "$RELEASES/$sha"
  git -C "$MIRROR" archive --format=tar "$full" | tar -x -C "$RELEASES/$sha" || { abort "导出源码失败"; return 1; }
  rm -rf "$RELEASES/$sha/data"
  docker build -q -t "$IMAGE:$sha" "$RELEASES/$sha" >&2 || docker build -q -t "$IMAGE:$sha" "$RELEASES/$sha" >&2 \
    || { abort "镜像构建失败"; return 1; }

  # 3. compose 只替换镜像 tag，其余（端口、卷、ASH_REGISTRATION 等）原样继承
  sed "s#image: $IMAGE:$old#image: $IMAGE:$sha#" "$RELEASES/$old/compose.deploy.yml" > "$RELEASES/$sha/compose.deploy.yml"
  grep -q "image: $IMAGE:$sha" "$RELEASES/$sha/compose.deploy.yml" || { abort "compose 替换镜像 tag 失败"; return 1; }

  # 4. 切换 + 冒烟，失败回滚
  started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  switch_to "$sha" || log "compose up 报错，交给冒烟判定"
  if smoke "$before" "$started"; then
    gh_status success "$IMAGE:$sha live"
    printf '%s deployed %s (from %s)\n' "$(date '+%F %T')" "$sha" "$old" >> "$HISTORY"
    log "✅ $IMAGE:$sha 已上线"
    prune_images
    return 0
  fi
  log "冒烟失败，回滚到 $IMAGE:$old"
  switch_to "$old"
  wait_healthy && log "已回滚到 $IMAGE:$old" || log "回滚后仍不健康，需要人工介入！"
  log "如果新版本做过不兼容的迁移，还要用 backup-before-$sha.db / backup-files-before-$sha.tgz 恢复数据（见 docs/deploy.md）"
  gh_status failure "smoke failed, rolled back to $IMAGE:$old"
  printf '%s FAILED %s (rolled back to %s)\n' "$(date '+%F %T')" "$sha" "$old" >> "$HISTORY"
  return 1
}

with_lock() {
  exec 9>"$CD_HOME/lock"
  flock -n 9 || { log "另一个部署正在进行"; exit 0; }
}

cmd_poll() {
  with_lock
  sync_mirror
  local head sha
  head=$(git -C "$MIRROR" rev-parse refs/heads/main)
  sha=${head:0:7}
  [ "$sha" = "$(current_tag)" ] && return 0
  [ -f "$STATE/failed-$sha" ] && return 0   # 失败过的提交不自动重试，修好后推新提交即可
  case "$(ci_state "$head")" in
    success) deploy "$head" || touch "$STATE/failed-$sha" ;;
    failure) log "main@$sha 的 CI 没通过，不部署"; touch "$STATE/failed-$sha" ;;
    *) log "main@$sha 等待 CI" ;;
  esac
}

cmd_deploy() {
  local ref=${1:-} force=${2:-}
  [ -n "$ref" ] || die "用法：ash-cd deploy <sha> [--force]"
  with_lock
  sync_mirror
  local full; full=$(git -C "$MIRROR" rev-parse --verify "$ref^{commit}") || die "找不到提交 $ref"
  if [ "$force" != "--force" ]; then
    [ "$(ci_state "$full")" = success ] || die "${full:0:7} 的 CI 没有全部通过（--force 可跳过）"
  fi
  rm -f "$STATE/failed-${full:0:7}"
  deploy "$full"
}

cmd_rollback() {
  with_lock
  local target=${1:-} current; current=$(current_tag)
  if [ -z "$target" ]; then
    target=$(grep -E ' deployed [0-9a-f]{7} ' "$HISTORY" 2>/dev/null | tail -1 | sed -E 's/.*\(from ([0-9a-f]+)\)/\1/')
    [ -n "$target" ] || die "历史里没有可回滚的版本，请指定：ash-cd rollback <tag>"
  fi
  docker image inspect "$IMAGE:$target" >/dev/null 2>&1 || die "镜像 $IMAGE:$target 已不存在，用 ash-cd deploy $target 重新构建"
  log "回滚：$IMAGE:$current → $IMAGE:$target"
  switch_to "$target"
  wait_healthy || die "$IMAGE:$target 没有就绪"
  touch "$STATE/failed-$current"   # 防止定时器马上又把刚回滚掉的版本部署回去
  printf '%s rollback %s (from %s)\n' "$(date '+%F %T')" "$target" "$current" >> "$HISTORY"
  log "✅ 已回滚到 $IMAGE:$target；$IMAGE:$current 被标记为失败，main 出现新提交前不会自动重新部署"
}

cmd_status() {
  sync_mirror
  local head; head=$(git -C "$MIRROR" rev-parse refs/heads/main)
  echo "线上版本：$IMAGE:$(current_tag)"
  echo "main 最新：${head:0:7}  CI：$(ci_state "$head")$([ -f "$STATE/failed-${head:0:7}" ] && echo '  （已标记失败，不会自动部署）')"
  echo "定时器：  $(systemctl --user is-active ash-cd.timer 2>/dev/null || true)"
  echo "最近部署："
  tail -5 "$HISTORY" 2>/dev/null | sed 's/^/  /' || echo "  （无）"
}

case "${1:-}" in
  poll) cmd_poll ;;
  deploy) shift; cmd_deploy "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  status) cmd_status ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
