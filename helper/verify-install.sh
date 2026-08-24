#!/bin/sh
# Проверяет, что установленное действительно принадлежит root и закрыто на
# запись остальным. Отдельным файлом — чтобы можно было запускать и просто
# так, для диагностики, без переустановки.
set -eu

BASE="/Library/Application Support/Prism"
bad=0

check() {
  path="$1"; want_mode="$2"
  if [ ! -e "$path" ]; then echo "  ✗ нет: $path"; bad=1; return; fi
  owner=$(stat -f '%Su' "$path")
  mode=$(stat -f '%Lp' "$path")
  if [ "$owner" != "root" ]; then echo "  ✗ $path принадлежит $owner, а должен root"; bad=1; fi
  # Групповая или всеобщая запись — дыра: подменят бинарь, и валидация
  # конфига уже ничего не значит.
  case "$mode" in
    *[2367]) echo "  ✗ $path доступен на запись не только root (права $mode)"; bad=1 ;;
  esac
  if [ -n "$want_mode" ] && [ "$mode" != "$want_mode" ]; then
    echo "  ! $path: права $mode, ожидались $want_mode"
  fi
}

echo "prism-verify: проверяю установку"
check "/Library/PrivilegedHelperTools/prism-helper" 755
check "$BASE" 755
check "$BASE/core/sing-box" 755
check "$BASE/rules" 755
check "$BASE/state" 700
check "/Library/LaunchDaemons/com.prism.vpn.helper.plist" 644
check "$BASE/run" 755

# Предки тоже: право переименовать каталог равно праву подменить содержимое.
for d in "/Library/PrivilegedHelperTools" "/Library/Application Support" "/Library" "/"; do
  check "$d" ""
done

if [ "$bad" = "0" ]; then echo "prism-verify: всё в порядке"; else echo "prism-verify: НАЙДЕНЫ ПРОБЛЕМЫ" >&2; fi
exit "$bad"
