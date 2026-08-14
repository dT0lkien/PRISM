/* Собирает src/shared/*.ts в один JS-файл для JavaScriptCore на iOS.

   Смысл: ядро логики — разбор ссылок и сборка конфига sing-box — остаётся
   единственным на обе платформы. Windows-версия исполняет эти файлы как ESM
   через electron-vite, iOS-приложение исполняет этот бандл в JSContext.
   Правишь парсер один раз — чинится везде.

   Зависимостей нет: типы снимает сам Node (>=22.13), склейка своя.
   Это осознанно — в репозитории уже так распакован zip в fetch-resources.mjs.

   Запуск:  node scripts/build-shared-js.mjs [--check]
     --check  только проверить, что бандл собирается и совпадает с файлом на диске
              (для CI: ловит забытый пересбор после правки src/shared) */

import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const POLYFILLS = join(ROOT, 'scripts', 'jsc-polyfills.js')

/* --src и --out нужны, чтобы собрать бандл из произвольной копии src/shared —
   например из прошлой ревизии, для сверки, что Windows-ветка не поехала. */
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const SRC = arg('src', join(ROOT, 'src', 'shared'))
const OUT = arg('out', join(ROOT, 'ios', 'PrismCore', 'Sources', 'PrismCore', 'Resources', 'shared.js'))

/* Топологический порядок: каждый модуль идёт после тех, чьи значения читает
   на верхнем уровне. defaults берёт DEFAULT_PRESETS у presets, поэтому строго
   после него — иначе const попадёт во временную мёртвую зону. */
const ORDER = ['types', 'rulesets', 'presets', 'defaults', 'parsers', 'subscriptions', 'config-builder']

/** Строки вида `import ... from './сосед'` — после склейки не нужны. */
const RE_LOCAL_IMPORT = /^\s*import\s[\s\S]*?from\s+['"]\.[^'"]*['"];?\s*$/gm
/** Ведущее слово `export` у объявления — область видимости теперь общая. */
const RE_EXPORT_KW = /^export\s+(?=(?:const|let|function|class|async)\b)/gm
/** Имена значений, которые модуль отдаёт наружу. */
const RE_EXPORTED_NAME = /^export\s+(?:const|let|class|(?:async\s+)?function)\s+([A-Za-z0-9_$]+)/gm

function build() {
  const chunks = []
  const exported = []
  /** имя -> файл, где оно уже объявлено; ловит коллизии при склейке */
  const seen = new Map()

  for (const name of ORDER) {
    const file = join(SRC, `${name}.ts`)
    const ts = readFileSync(file, 'utf8')

    // mode:'strip' заменяет типы пробелами, поэтому номера строк переживают
    // сборку — трассировка ошибок из JSC ведёт в исходный .ts.
    const js = stripTypeScriptTypes(ts, { mode: 'strip' })

    for (const m of js.matchAll(RE_EXPORTED_NAME)) {
      const prev = seen.get(m[1])
      if (prev) {
        throw new Error(
          `коллизия имён при склейке: «${m[1]}» объявлено и в ${prev}.ts, и в ${name}.ts.\n` +
            `В общей области видимости это молча сломает iOS-сборку — переименуй одно из двух.`
        )
      }
      seen.set(m[1], name)
      exported.push(m[1])
    }

    // Локальные объявления тоже участвуют в проверке коллизий: они попадают
    // в ту же область видимости, что и экспортируемые.
    for (const m of js.matchAll(/^(?:const|let|class|(?:async\s+)?function)\s+([A-Za-z0-9_$]+)/gm)) {
      const prev = seen.get(m[1])
      if (prev && prev !== name) {
        throw new Error(
          `коллизия имён при склейке: «${m[1]}» объявлено и в ${prev}.ts, и в ${name}.ts.\n` +
            `В общей области видимости это молча сломает iOS-сборку — переименуй одно из двух.`
        )
      }
      seen.set(m[1], name)
    }

    const body = js.replace(RE_LOCAL_IMPORT, '').replace(RE_EXPORT_KW, '')
    chunks.push(`/* ─────────── src/shared/${name}.ts ─────────── */\n${body.trim()}\n`)
  }

  const api = exported
    .slice()
    .sort()
    .map((n) => `    ${n}: typeof ${n} === 'undefined' ? undefined : ${n}`)
    .join(',\n')

  const code =
    `/* СГЕНЕРИРОВАНО scripts/build-shared-js.mjs — не править руками.\n` +
    `   Источник: src/shared/*.ts, общий с Windows-версией.\n` +
    `   Пересобрать: node scripts/build-shared-js.mjs */\n\n` +
    readFileSync(POLYFILLS, 'utf8') +
    `\n'use strict';\n(function (root) {\n` +
    chunks.join('\n') +
    `\n  root.PrismShared = {\n${api}\n  };\n})(globalThis);\n`

  return { code, exported }
}

const { code: out, exported } = build()

if (process.argv.includes('--check')) {
  const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (old !== out) {
    console.error('shared.js устарел — выполни: node scripts/build-shared-js.mjs')
    process.exit(1)
  }
  console.log('shared.js актуален')
} else {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, out, 'utf8')
  const kb = (Buffer.byteLength(out) / 1024).toFixed(1)
  console.log(`${OUT.replace(ROOT + '/', '')} — ${kb} КБ, экспортов: ${exported.length}`)
}
