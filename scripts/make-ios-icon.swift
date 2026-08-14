#!/usr/bin/env swift

// Готовит иконку приложения для iOS из общего логотипа Prism.
//
// Требования Apple к иконке отличаются от десктопных: ровно 1024×1024,
// без альфа-канала и без собственного скругления — маску накладывает система.
// В resources/icons/logo.png скругление уже вписано в картинку, поэтому здесь
// изображение слегка увеличивается и обрезается по центру: закруглённые углы
// уходят за границу кадра, и двойного скругления не возникает.
//
// Запуск: swift scripts/make-ios-icon.swift

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let source = root.appendingPathComponent("resources/icons/logo.png")
let outputDir = root.appendingPathComponent("ios/Prism/Assets.xcassets/AppIcon.appiconset")
let output = outputDir.appendingPathComponent("icon-1024.png")

let side = 1024
/// Насколько увеличиваем перед обрезкой. При радиусе скругления около 18%
/// стороны дуга отступает от угла примерно на 5% — этого запаса хватает.
let overscan = 1.12

guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
      let logo = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
else {
    FileHandle.standardError.write("не удалось прочитать \(source.path)\n".data(using: .utf8)!)
    exit(1)
}

guard let context = CGContext(
    data: nil,
    width: side,
    height: side,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    // noneSkipLast — картинка без альфа-канала, как требует App Store
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else {
    FileHandle.standardError.write("не удалось создать холст\n".data(using: .utf8)!)
    exit(1)
}

// Фон под прозрачными углами исходника — тёмный цвет самого логотипа
context.setFillColor(red: 0.043, green: 0.063, blue: 0.125, alpha: 1)
context.fill(CGRect(x: 0, y: 0, width: side, height: side))

context.interpolationQuality = .high
let scaled = Double(side) * overscan
let offset = (Double(side) - scaled) / 2
context.draw(logo, in: CGRect(x: offset, y: offset, width: scaled, height: scaled))

guard let result = context.makeImage() else {
    FileHandle.standardError.write("не удалось получить изображение\n".data(using: .utf8)!)
    exit(1)
}

try? FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

guard let destination = CGImageDestinationCreateWithURL(
    output as CFURL, UTType.png.identifier as CFString, 1, nil
) else {
    FileHandle.standardError.write("не удалось создать \(output.path)\n".data(using: .utf8)!)
    exit(1)
}
CGImageDestinationAddImage(destination, result, nil)
guard CGImageDestinationFinalize(destination) else {
    FileHandle.standardError.write("не удалось записать PNG\n".data(using: .utf8)!)
    exit(1)
}

// Xcode 14+ обходится одним размером: остальные система масштабирует сама
let contents = """
{
  "images" : [
    {
      "filename" : "icon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}

"""
try contents.write(to: outputDir.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)

print("готово: ios/Prism/Assets.xcassets/AppIcon.appiconset/icon-1024.png")
