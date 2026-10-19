#!/usr/bin/env bash
set -euo pipefail

wait_for_http_status() {
  local url=$1 expected=$2 label=$3
  local status=000 deadline=$((SECONDS + 20)) waiting=0
  while true; do
    if ! status=$(curl --silent --show-error --http1.1 --connect-timeout 3 --max-time 4 \
      --header 'Connection: close' --output /dev/null --write-out '%{http_code}' "$url"); then
      status=000
    fi
    case " $expected " in
      *" $status "*) printf '%s: %s\n' "$label" "$status"; return 0 ;;
    esac
    if [ "$SECONDS" -ge "$deadline" ]; then
      printf 'HTTP verification failed: %s returned %s (expected %s).\n' "$label" "$status" "$expected" >&2
      return 1
    fi
    if [ "$waiting" = 0 ]; then
      printf 'Waiting for Nginx configuration to become active: %s currently returns %s.\n' "$label" "$status"
      waiting=1
    fi
    sleep 1
  done
}

verify_routes() {
  local base_url=${1%/}
  wait_for_http_status "$base_url/" '200' 'Home' || return 1
  wait_for_http_status "$base_url/.well-known/apple-app-site-association" '200 503' 'apple-app-site-association' || return 1
  wait_for_http_status "$base_url/.well-known/assetlinks.json" '200 503' 'assetlinks.json' || return 1
  wait_for_http_status "$base_url/.env" '404' '.env protection' || return 1
  wait_for_http_status "$base_url/.git/config" '404' '.git protection' || return 1
  wait_for_http_status "$base_url/.well-known/private" '404' 'Other hidden-path protection' || return 1
  wait_for_http_status "$base_url/.well-known/assetlinks.json/extra" '404' 'Association suffix protection' || return 1
  wait_for_http_status "$base_url/.well-known/apple-app-site-association.bak" '404' 'Association backup protection' || return 1
}

if [ "${1:-}" = --check-only ]; then
  verify_routes "${2:-https://scharade.jp}"
  echo 'App association routing verified.'
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run this script with sudo on the VPS.' >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
candidate="$script_dir/security-nginx.conf"
target=/etc/nginx/conf.d/astro.conf
expected_before=fd9b1dc70c4544b1e213ee7341d5683706a1b2e350ecf25be14c92ef4193a4ba
expected_after=8913aed16a51bdee1c6ed25e5fef62e514b31a8299ec3340c7bed3be8178a533
current=$(sha256sum "$target" | cut -d ' ' -f 1)
candidate_hash=$(sha256sum "$candidate" | cut -d ' ' -f 1)

if [ "$candidate_hash" != "$expected_after" ]; then
  echo 'Prepared configuration changed. Review the diff before applying.' >&2
  exit 1
fi
if [ "$current" = "$expected_after" ]; then
  echo 'App association configuration is already installed; checking the running server.'
  /usr/sbin/nginx -t
  systemctl reload nginx
  verify_routes https://scharade.jp
  echo 'App association routing verified.'
  exit 0
fi
if [ "$current" != "$expected_before" ]; then
  echo 'Live Nginx configuration changed. Rebase and review the patch first.' >&2
  exit 1
fi

backup="${target}.before-mobile-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p -- "$target" "$backup"
rollback() {
  local failure=$?
  trap - ERR
  if install -o root -g root -m 0644 -- "$backup" "$target" &&
    /usr/sbin/nginx -t && systemctl reload nginx; then
    echo "Nginx configuration restored from $backup" >&2
  else
    echo "Nginx rollback failed; inspect the configuration and backup: $backup" >&2
  fi
  return "$failure"
}
trap rollback ERR
install -o root -g root -m 0644 -- "$candidate" "$target"
/usr/sbin/nginx -t
systemctl reload nginx

verify_routes https://scharade.jp
trap - ERR
echo "App association routing enabled. Backup: $backup"
