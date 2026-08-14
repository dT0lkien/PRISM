// swift-tools-version:5.9

import PackageDescription

/* PrismCore — общее ядро Prism на стороне Swift.

   Собственной логики разбора ссылок и сборки конфига здесь нет: пакет исполняет
   ios/PrismCore/Sources/PrismCore/Resources/shared.js, собранный из TypeScript
   в каталоге src/shared — тех же файлов, на которых работает Windows-версия.
   Пересборка бандла: node scripts/build-shared-js.mjs

   macOS в platforms указан не для продукта, а чтобы пакет собирался и тестировался
   обычным swift build/test — в том числе на голых Command Line Tools, без Xcode. */
let package = Package(
    name: "PrismCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "PrismCore", targets: ["PrismCore"])
    ],
    targets: [
        .target(
            name: "PrismCore",
            // Именно process, а не copy: copy сохраняет вложенный каталог Resources,
            // а на iOS бандлы плоские — codesign считает такую раскладку macOS-овой
            // и отказывается подписывать бандл. process выкладывает файлы в корень.
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "PrismCoreTests",
            dependencies: ["PrismCore"]
        )
    ]
)
