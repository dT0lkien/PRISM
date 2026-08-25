#!/bin/sh
# Установка привилегированного демона Prism. Запускается от root — приложение
# зовёт его один раз через osascript, дальше пароль не спрашивается никогда.
#
#   install.sh [--check] <helper> <sing-box> <каталог правил> <uid>
#
# --check: проверить аргументы и напечатать plist, ничего не устанавливая
#          и не требуя root (нужен для тестов).
#
# Идемпотентен: повторный запуск переустанавливает поверх — это и есть путь
# обновления при апдейте приложения.
set -eu

LABEL="com.prism.vpn.helper"
HELPER_DST="/Library/PrivilegedHelperTools/prism-helper"
BASE="/Library/Application Support/Prism"
CORE_DST="$BASE/core/sing-box"
RULES_DST="$BASE/rules"
STATE_DST="$BASE/state"
PLIST="/Library/LaunchDaemons/$LABEL.plist"
SOCK_DIR="$BASE/run"
SOCK="$SOCK_DIR/helper.sock"

die() { echo "prism-install: $1" >&2; exit 1; }

CHECK=0
if [ "${1:-}" = "--check" ]; then CHECK=1; shift; fi

[ $# -eq 4 ] || die "использование: install.sh [--check] <helper> <sing-box> <каталог правил> <uid>"
[ "$CHECK" = "1" ] || [ "$(id -u)" = "0" ] || die "нужно запускать от root"

SRC_HELPER="$1"; SRC_CORE="$2"; SRC_RULES="$3"; ALLOW_UID="$4"

[ -f "$SRC_HELPER" ] || die "не найден helper: $SRC_HELPER"
[ -f "$SRC_CORE" ]   || die "не найдено ядро: $SRC_CORE"
[ -d "$SRC_RULES" ]  || die "не найден каталог правил: $SRC_RULES"
case "$ALLOW_UID" in
  ''|*[!0-9]*) die "uid должен быть числом: $ALLOW_UID" ;;
esac
[ "$ALLOW_UID" != "0" ] || die "uid 0 бессмысленен: root и так может всё"

emit_plist() {
  cat <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$HELPER_DST</string>
    <string>-socket</string><string>$SOCK</string>
    <string>-core</string><string>$CORE_DST</string>
    <string>-rules</string><string>$RULES_DST</string>
    <string>-state</string><string>$STATE_DST</string>
    <string>-uid</string><string>$ALLOW_UID</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/prism-helper.log</string>
  <key>StandardErrorPath</key><string>/var/log/prism-helper.log</string>
</dict>
</plist>
PLISTEOF
}

if [ "$CHECK" = "1" ]; then
  emit_plist
  echo "prism-install: --check пройден, аргументы корректны" >&2
  exit 0
fi

# Старую задачу снимаем до подмены файлов: иначе launchd держит работающий
# бинарь, а ядро остаётся висеть с живым utun.
if launchctl print "system/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "system/$LABEL" 2>/dev/null || true
  i=0
  while launchctl print "system/$LABEL" >/dev/null 2>&1 && [ "$i" -lt 50 ]; do
    sleep 0.1; i=$((i+1))
  done
fi

install -d -o root -g wheel -m 0755 "/Library/PrivilegedHelperTools"
install -d -o root -g wheel -m 0755 "$BASE"
install -d -o root -g wheel -m 0755 "$BASE/core"
install -d -o root -g wheel -m 0755 "$RULES_DST"
# В рабочем каталоге лежит конфиг с паролями серверов — закрываем полностью.
install -d -o root -g wheel -m 0700 "$STATE_DST"
# 0755, а не 0700: пользователю нужно право пройти в каталог до сокета.
install -d -o root -g wheel -m 0755 "$SOCK_DIR"

install -o root -g wheel -m 0755 "$SRC_HELPER" "$HELPER_DST"
install -o root -g wheel -m 0755 "$SRC_CORE" "$CORE_DST"
rm -f "$RULES_DST"/*.srs
for f in "$SRC_RULES"/*.srs; do
  [ -e "$f" ] || continue
  install -o root -g wheel -m 0644 "$f" "$RULES_DST/"
done

emit_plist > "$PLIST"
chown root:wheel "$PLIST"
chmod 0644 "$PLIST"
plutil -lint "$PLIST" >/dev/null || die "получился некорректный plist"

launchctl bootstrap system "$PLIST" || die "launchctl bootstrap не отработал"
launchctl enable "system/$LABEL" 2>/dev/null || true

# Ждём сокет: без него приложению не с кем разговаривать.
i=0
while [ ! -S "$SOCK" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
[ -S "$SOCK" ] || die "демон не поднял сокет — смотрите /var/log/prism-helper.log"

# Самопроверка: если что-то доверенное доступно на запись не только root,
# установка бессмысленна — подменят бинарь, и валидация конфига не спасёт.
sh "$(dirname "$0")/verify-install.sh" || die "самопроверка не прошла"

echo "prism-install: готово, демон $LABEL работает"
