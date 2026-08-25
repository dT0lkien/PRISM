#!/bin/sh
# Полное удаление демона. Ядро гасится вместе с задачей: launchd шлёт SIGTERM,
# helper уносит туннель за собой.
set -eu
LABEL="com.prism.vpn.helper"
[ "$(id -u)" = "0" ] || { echo "нужно запускать от root" >&2; exit 1; }

launchctl bootout "system/$LABEL" 2>/dev/null || true
rm -f "/Library/LaunchDaemons/$LABEL.plist"
rm -f "/Library/PrivilegedHelperTools/prism-helper"
rm -rf "/Library/Application Support/Prism"
rm -rf "/var/run/prism"   # место из ранней версии
echo "prism-uninstall: удалено"
