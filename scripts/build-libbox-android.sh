#!/bin/sh
# Собирает libbox для ARM64 из той же версии sing-box, что использует Prism.
set -eu

VERSION=1.13.15
GOMOBILE_VERSION=v0.1.12
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/prism-libbox.XXXXXXXX")
trap 'rm -rf "$WORK"' EXIT
OUT="$ROOT/android/app/libs"

: "${ANDROID_HOME:=$HOME/Library/Android/sdk}"
: "${JAVA_HOME:=/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
: "${ANDROID_NDK_HOME:=$ANDROID_HOME/ndk/28.2.13676358}"
export ANDROID_HOME ANDROID_NDK_HOME JAVA_HOME

test -d "$ANDROID_NDK_HOME" || { echo "Не найден Android NDK: $ANDROID_NDK_HOME" >&2; exit 1; }
test -x "$JAVA_HOME/bin/java" || { echo "Не найден JDK: $JAVA_HOME" >&2; exit 1; }
export GOBIN="$WORK/bin"
export PATH="$GOBIN:$JAVA_HOME/bin:$PATH"
go install "github.com/sagernet/gomobile/cmd/gomobile@$GOMOBILE_VERSION" \
    "github.com/sagernet/gomobile/cmd/gobind@$GOMOBILE_VERSION"

curl -fsSL --retry 2 "https://codeload.github.com/SagerNet/sing-box/tar.gz/refs/tags/v$VERSION" -o "$WORK/sing-box.tar.gz"
tar -xzf "$WORK/sing-box.tar.gz" -C "$WORK"
cd "$WORK/sing-box-$VERSION"
cp "$ROOT/android/core/prism_probe.go" experimental/libbox/

gomobile bind -o "$WORK/libbox.aar" -target android/arm64 -androidapi 26 \
    -javapkg=io.nekohasekai -libname=box -trimpath -buildvcs=false \
    -tags with_gvisor,with_quic,with_wireguard,with_utls,with_clash_api,badlinkname,tfogo_checklinkname0 \
    -ldflags "-X github.com/sagernet/sing-box/constant.Version=$VERSION -X internal/godebug.defaultGODEBUG=multipathtcp=0 -s -w -checklinkname=0" \
    ./experimental/libbox

mkdir -p "$OUT"
mv "$WORK/libbox.aar" "$OUT/libbox.aar"
ls -lh "$OUT/libbox.aar"
