#!/bin/sh
# Собирает ядро sing-box в Libbox.xcframework для iOS.
#
# На десктопе Prism запускает sing-box отдельным процессом. На iOS так нельзя:
# приложение не имеет права исполнять посторонние бинарники, поэтому ядро
# линкуется внутрь и работает в адресном пространстве NetworkExtension.
#
# Версия ядра держится ровно та же, что у Windows-сборки, — см. SING_BOX
# в scripts/fetch-resources.mjs. Расхождение версий означало бы, что конфиг,
# проверенный на десктопе, может не подойти телефону.
#
# Требуется: Go и Xcode. Результат: ios/Libbox.xcframework (в git не хранится).
#
# Запуск:  sh scripts/build-libbox.sh

set -e

VERSION=1.13.15
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK="${TMPDIR:-/tmp}/prism-libbox"
OUT="$ROOT/ios/Libbox.xcframework"

command -v go >/dev/null || { echo "нет Go: brew install go"; exit 1; }
command -v xcodebuild >/dev/null || { echo "нет Xcode"; exit 1; }

GOBIN=$(go env GOPATH)/bin
export PATH="$PATH:$GOBIN"

# Форк SagerNet, а не апстримный golang.org/x/mobile: сборка ядра рассчитана
# именно на него, и версия закреплена их Makefile
echo "▸ gomobile (форк SagerNet)"
go install -v github.com/sagernet/gomobile/cmd/gomobile@v0.1.12
go install -v github.com/sagernet/gomobile/cmd/gobind@v0.1.12

echo "▸ исходники sing-box $VERSION"
rm -rf "$WORK"
git clone --depth 1 --branch "v$VERSION" https://github.com/SagerNet/sing-box "$WORK"

# Штатный сборщик самого sing-box: он знает нужный набор тегов сборки,
# перечислять их руками — верный способ получить ядро без нужных протоколов.
# Ограничиваемся iOS и симулятором: tvOS и macOS в Prism не нужны.
echo "▸ сборка Libbox (займёт несколько минут)"
cd "$WORK"
go run ./cmd/internal/build_libbox -target apple -platform ios,iossimulator

rm -rf "$OUT"
mv "$WORK/Libbox.xcframework" "$OUT"
rm -rf "$WORK"

# gomobile выдаёт фреймворки в раскладке macOS — с каталогом Versions и
# символическими ссылками. На iOS бандлы плоские, и Xcode отказывается
# упаковывать такой фреймворк в приложение. Раскладываем содержимое в корень.
echo "▸ приведение фреймворков к плоской раскладке iOS"
for slice in "$OUT"/*/Libbox.framework; do
	[ -d "$slice/Versions" ] || continue
	(
		cd "$slice"
		rm -f Headers Libbox Modules Resources
		mv Versions/A/Headers Versions/A/Libbox Versions/A/Modules .
		mv Versions/A/Resources/Info.plist .
		rm -rf Versions
	)

	# Info.plist от gomobile пустой: на macOS это сходит с рук, на iOS Xcode
	# отказывается упаковывать фреймворк без описания. Пишем минимально нужное.
	case "$slice" in
	*simulator*) platform=iPhoneSimulator ;;
	*) platform=iPhoneOS ;;
	esac
	cat > "$slice/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key><string>en</string>
	<key>CFBundleExecutable</key><string>Libbox</string>
	<key>CFBundleIdentifier</key><string>io.sagernet.libbox</string>
	<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
	<key>CFBundleName</key><string>Libbox</string>
	<key>CFBundlePackageType</key><string>FMWK</string>
	<key>CFBundleShortVersionString</key><string>$VERSION</string>
	<key>CFBundleVersion</key><string>1</string>
	<key>MinimumOSVersion</key><string>17.0</string>
	<key>CFBundleSupportedPlatforms</key><array><string>$platform</string></array>
</dict>
</plist>
PLIST
done

echo "▸ готово: ios/Libbox.xcframework"
du -sh "$OUT"
