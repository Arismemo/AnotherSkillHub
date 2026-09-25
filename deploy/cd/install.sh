#!/usr/bin/env bash
# 在 seed-SER9 上安装 / 更新 ash-cd（systemd 用户定时器）。可重复执行。
#
# 脚本被复制到 ~/services/skillhub-cd/bin/ash-cd 固定下来：合并到 main 的改动不会悄悄改变部署逻辑，
# 修改 deploy/cd/ 之后要在服务器上重新执行本脚本才生效。
# 前提：当前用户在 docker 组、gh 已登录（gh auth status）、用户 linger 已开启（loginctl enable-linger）。
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
home_dir="$HOME/services/skillhub-cd"
unit_dir="$HOME/.config/systemd/user"

command -v gh >/dev/null || { echo "需要 gh CLI" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh 未登录：gh auth login" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "当前用户无法访问 docker" >&2; exit 1; }
[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ] \
  || echo "提示：未开启 linger，注销后定时器会停；执行 sudo loginctl enable-linger $USER" >&2

mkdir -p "$home_dir/bin" "$unit_dir"
install -m 0755 "$here/ash-cd.sh" "$home_dir/bin/ash-cd"
install -m 0644 "$here/ash-cd.service" "$here/ash-cd.timer" "$unit_dir/"
systemctl --user daemon-reload
systemctl --user enable --now ash-cd.timer

echo "已安装：$home_dir/bin/ash-cd"
systemctl --user list-timers ash-cd.timer --no-pager
echo "查看日志：journalctl --user -u ash-cd -f     查看状态：$home_dir/bin/ash-cd status"
