/* Пересобирает белый список ключей для helper/validate.go из фикстур.
   Фикстуры снимает scripts/gen-helper-fixtures.ts настоящим buildConfig, без
   extraConfig — то есть список заведомо описывает только то, что порождает наш
   генератор. Держать его руками нельзя: одна забытая опция протокола, и у
   пользователя не поднимется туннель.
   Запуск: node scripts/gen-helper-paths.mjs */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'helper/testdata'
// Имена заголовков произвольные — такие ветки сворачиваем в префикс.
const PREFIXES = ['outbounds[].transport.headers.']
// Страховка: даже появись такое в фикстуре, в белый список оно не попадёт.
const NEVER = /(^|\.)(executable_path|extra_args|command|output|log_file)$/

const paths = new Set()
const walk = (v, p) => {
  if (Array.isArray(v)) return v.forEach((x) => walk(x, `${p}[]`))
  if (v && typeof v === 'object') return Object.keys(v).forEach((k) => walk(v[k], p ? `${p}.${k}` : k))
  paths.add(p)
}
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  walk(JSON.parse(readFileSync(join(DIR, f), 'utf8')), '')
}

const kept = [...paths]
  .filter((p) => !PREFIXES.some((pre) => p.startsWith(pre)))
  .filter((p) => {
    if (NEVER.test(p)) { console.error(`!! опасный ключ в фикстуре, не включаю: ${p}`); return false }
    return true
  })
  .sort()

const body = kept.map((p) => `\t${JSON.stringify(p)}: true,`).join('\n')
const pre = PREFIXES.map((p) => `\t${JSON.stringify(p)},`).join('\n')
writeFileSync('helper/allowed_paths.go', `package main

// Сгенерировано: node scripts/gen-helper-paths.mjs — руками не править.
// Источник — helper/testdata/*.json, снятые настоящим buildConfig.

var allowedPaths = map[string]bool{
${body}
}

// Ветки с произвольными именами ключей (заголовки HTTP).
var allowedPrefixes = []string{
${pre}
}
`)
console.log(`ключей: ${kept.length}, префиксов: ${PREFIXES.length} → helper/allowed_paths.go`)
