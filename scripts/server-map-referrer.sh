#!/usr/bin/env bash
set -euo pipefail
if [[ "$EUID" != 0 ]]; then
  echo 'sudo bash scripts/server-map-referrer.sh で実行してください。' >&2
  exit 1
fi
task_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_config=/etc/nginx/conf.d/astro.conf
task_backup="/root/scharade-map-referrer-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$task_backup"
cp -p "$task_config" "$task_backup/astro.conf"
install -m 644 "$task_dir/deploy/security-nginx.conf" "$task_config"
if ! nginx -t; then
  cp -p "$task_backup/astro.conf" "$task_config"
  exit 1
fi
if ! systemctl reload nginx; then
  cp -p "$task_backup/astro.conf" "$task_config"
  nginx -t && systemctl reload nginx
  exit 1
fi
echo '地図ページだけ参照元のドメインを送る設定にしました。その他の画面とトークン付きURLでは参照元を送りません。'
ufw status verbose
