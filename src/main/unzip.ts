/* Распаковка zip без сторонних пакетов — хватает для релизных архивов:
   deflate или без сжатия, без шифрования и zip64. Та же логика, что в
   scripts/fetch-resources.mjs, только на TypeScript. */

import { inflateRawSync } from 'node:zlib'

/** Файлы архива по полному пути внутри него. Каталоги пропускаются. */
export function unzip(buf: Buffer, maxTotal = 64 * 1024 * 1024): Map<string, Buffer> {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Это не zip-архив')

  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  let total = 0
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Архив повреждён')
    const flags = buf.readUInt16LE(off + 8)
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const size = buf.readUInt32LE(off + 24)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    off += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue
    if (flags & 1) throw new Error('Архив зашифрован')
    total += size
    if (total > maxTotal) throw new Error('Архив слишком большой')

    const lnLen = buf.readUInt16LE(localOff + 26)
    const leLen = buf.readUInt16LE(localOff + 28)
    const dataOff = localOff + 30 + lnLen + leLen
    const raw = buf.subarray(dataOff, dataOff + compSize)
    if (method !== 0 && method !== 8) throw new Error(`Неподдерживаемое сжатие в архиве (${method})`)
    /* Размер в заголовке пишет тот, кто собрал архив. Без потолка у inflate
       запись «10 байт», которая разворачивается в гигабайты, уронила бы
       main-процесс раньше проверки maxTotal выше. */
    let data: Buffer
    try {
      data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) })
    } catch {
      throw new Error('Архив повреждён')
    }
    if (data.length !== size) throw new Error('Архив повреждён')
    out.set(name, data)
  }
  return out
}
