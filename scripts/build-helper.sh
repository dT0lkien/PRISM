#!/bin/sh
# Собирает привилегированный демон. Отдельный бинарь, а не часть Electron:
# от root должно работать как можно меньше кода, и без Node-рантайма.
# Кладём рядом с ядром — оттуда его заберёт и установщик, и electron-builder.
set -eu
cd "$(dirname "$0")/.."

OUT="resources/helper"
VERSION="${PRISM_HELPER_VERSION:-1}"

mkdir -p "$OUT"
# Обе архитектуры: приложение может ставиться и на Intel-мак.
for arch in arm64 amd64; do
  GOOS=darwin GOARCH="$arch" CGO_ENABLED=0 \
    go build -C helper -trimpath -ldflags "-s -w -X main.version=$VERSION" \
      -o "../$OUT/prism-helper-$arch" .
done
# Универсальный бинарь: один файл на любую машину.
lipo -create -output "$OUT/prism-helper" "$OUT/prism-helper-arm64" "$OUT/prism-helper-amd64"
rm -f "$OUT/prism-helper-arm64" "$OUT/prism-helper-amd64"
chmod 0755 "$OUT/prism-helper"

# lipo склеивает срезы, но подпись при этом теряется: у arm64 она была
# ad-hoc от линкера, у x86_64 её нет вовсе, и codesign бракует результат.
# На Apple Silicon неподписанное просто не запустится, поэтому подписываем
# явно. Для раздачи здесь встанет Developer ID вместо прочерка.
codesign --force --sign "${PRISM_SIGN_ID:--}" --timestamp=none "$OUT/prism-helper"
codesign --verify --strict "$OUT/prism-helper" || {
  echo "подпись не прошла проверку" >&2; exit 1
}

echo "собран: $OUT/prism-helper ($(lipo -archs "$OUT/prism-helper"), $(du -h "$OUT/prism-helper" | cut -f1))"
