#!/bin/sh
# Собирает ядро sing-box в libbox.aar для Android.
#
# Android-аналог scripts/build-libbox.sh. Версия ядра держится та же, что у
# Windows- и iOS-сборок, — см. SING_BOX в scripts/fetch-resources.mjs.
#
# Две правки к штатному сборщику sing-box, обе намеренные:
#
#   1. Снята проверка версии Java. Сборщик требует ровно openjdk 17, а JDK 21
#      из состава Android Studio работает не хуже и уже есть на машине.
#
#   2. Урезан набор протоколов. Штатная сборка тянет всё подряд, включая
#      Tailscale, naive и ACME, которыми Prism не пользуется. Без них ядро
#      уменьшается с 62 до 40 МБ, а APK — со 140 до 56 МБ.
#      Остаются: gvisor (туннель), quic (hysteria2 и tuic), utls (маскировка
#      TLS), wireguard, clash_api (статистика).
#
# Требуется: Go, Android SDK с NDK, JDK. Результат: android/app/libs/libbox.aar
# (в git не хранится).
#
# Запуск:  sh scripts/build-libbox-android.sh

set -e

VERSION=1.13.15
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK="${TMPDIR:-/tmp}/prism-libbox-android"
OUT="$ROOT/android/app/libs"

command -v go >/dev/null || { echo "нет Go: brew install go"; exit 1; }

: "${ANDROID_HOME:=$HOME/Library/Android/sdk}"
[ -d "$ANDROID_HOME" ] || { echo "не найден Android SDK: $ANDROID_HOME"; exit 1; }
export ANDROID_HOME

NDK_DIR=$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | tail -1)
[ -n "$NDK_DIR" ] || { echo "не найден NDK в $ANDROID_HOME/ndk"; exit 1; }
export ANDROID_NDK_HOME="$NDK_DIR"

: "${JAVA_HOME:=/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export JAVA_HOME

export PATH="$PATH:$(go env GOPATH)/bin:$JAVA_HOME/bin"

# Форк SagerNet, а не апстримный golang.org/x/mobile: сборка ядра рассчитана
# именно на него, и версия закреплена их Makefile
echo "▸ gomobile (форк SagerNet)"
go install -v github.com/sagernet/gomobile/cmd/gomobile@v0.1.12
go install -v github.com/sagernet/gomobile/cmd/gobind@v0.1.12

echo "▸ исходники sing-box $VERSION"
rm -rf "$WORK"
git clone --depth 1 --branch "v$VERSION" https://github.com/SagerNet/sing-box "$WORK"

MAIN="$WORK/cmd/internal/build_libbox/main.go"

echo "▸ снятие проверки версии Java"
perl -pi -e 's/^\tcheckJavaVersion\(\)$/\t\/\/ снято build-libbox-android.sh: JDK 21 подходит/' "$MAIN"
grep -q "снято build-libbox-android.sh" "$MAIN" || { echo "не удалось снять проверку Java"; exit 1; }

echo "▸ урезание набора протоколов"
perl -pi -e 's/^\tsharedTags = append\(sharedTags, "with_gvisor".*$/\tsharedTags = append(sharedTags, "with_gvisor", "with_quic", "with_wireguard", "with_utls", "with_clash_api", "badlinkname", "tfogo_checklinkname0")/' "$MAIN"
perl -pi -e 's/^\tsharedTags = append\(sharedTags, "with_tailscale".*$/\t\/\/ Tailscale убран build-libbox-android.sh/' "$MAIN"
grep -q "Tailscale убран" "$MAIN" || { echo "не удалось урезать теги"; exit 1; }

echo "▸ сборка (займёт несколько минут)"
cd "$WORK"
# Только arm64: на нём работают все современные телефоны и эмулятор на
# маках Apple Silicon. Каждая лишняя архитектура — плюс 40 МБ к APK.
go run ./cmd/internal/build_libbox -target android -platform android/arm64

mkdir -p "$OUT"
rm -f "$OUT"/libbox*.aar
mv "$WORK/libbox.aar" "$OUT/libbox.aar"
rm -rf "$WORK"

echo "▸ готово: android/app/libs/libbox.aar"
ls -lh "$OUT/libbox.aar" | awk '{print "  ", $5}'
