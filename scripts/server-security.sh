#!/usr/bin/env bash
set -euo pipefail
if [[ "$EUID" != 0 ]]; then
  echo 'sudo bash scripts/server-security.sh で実行してください。' >&2
  exit 1
fi
task_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test -s /home/ubuntu/.ssh/authorized_keys
test -f "$task_dir/deploy/security-nginx.conf"
test -f "$task_dir/deploy/security-sshd.conf"
task_backup="/root/scharade-security-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$task_backup"
cp -p /etc/nginx/conf.d/astro.conf "$task_backup/astro.conf"
cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.d "$task_backup/"
cp -a /etc/ufw "$task_backup/ufw"
ufw status verbose > "$task_backup/ufw-before.txt"
if [[ -f /etc/ssh/sshd_config.d/00-scharade-security.conf ]]; then
  cp -p /etc/ssh/sshd_config.d/00-scharade-security.conf "$task_backup/previous-security.conf"
fi
restore_configs() {
  cp -p "$task_backup/astro.conf" /etc/nginx/conf.d/astro.conf
  if [[ -f "$task_backup/previous-security.conf" ]]; then
    cp -p "$task_backup/previous-security.conf" /etc/ssh/sshd_config.d/00-scharade-security.conf
  else
    rm -f /etc/ssh/sshd_config.d/00-scharade-security.conf
  fi
}
install -m 644 "$task_dir/deploy/security-nginx.conf" /etc/nginx/conf.d/astro.conf
install -m 644 "$task_dir/deploy/security-sshd.conf" /etc/ssh/sshd_config.d/00-scharade-security.conf
if ! nginx -t || ! /usr/sbin/sshd -t; then restore_configs; exit 1; fi
task_effective="$(/usr/sbin/sshd -T -C user=ubuntu,host=scharade.jp,addr=127.0.0.1)"
for task_line in 'permitrootlogin no' 'passwordauthentication no' 'kbdinteractiveauthentication no' 'pubkeyauthentication yes'; do
  if ! grep -qx "$task_line" <<< "$task_effective"; then restore_configs; echo 'SSHの実効設定を確認してください。反映は中止しました。' >&2; exit 1; fi
done
# Keep this terminal connected until a separate key-authenticated SSH login succeeds.
# Insert before any existing broad allow rule so that SSH limiting is effective.
ufw insert 1 limit 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
if ! systemctl reload nginx || ! systemctl reload ssh; then
  restore_configs
  nginx -t && systemctl reload nginx
  /usr/sbin/sshd -t && systemctl reload ssh
  exit 1
fi
chmod 700 /home/ubuntu/scharade-data /home/ubuntu/scharade-backups
find /home/ubuntu/scharade-data -maxdepth 1 -type f -exec chmod 600 {} +
chmod 600 /var/www/my-astro-app/.env
echo "反映しました。設定バックアップ: $task_backup"
echo 'この接続を保ったまま、別の端末でSSH鍵ログインとサイトの表示を確認してください。'
