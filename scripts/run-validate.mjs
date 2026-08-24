/* Собирает validate-config.ts через esbuild (он и так есть в зависимостях vite) и запускает. */
import * as esbuild from 'esbuild'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/* Формат cjs и alias для @shared — как в run-store-test.mjs и run-e2e.mjs:
   проверка разбора подписки тянет src/main/subs.ts, а тот импортирует @shared/*
   и пакет `yaml`. В корневом tsconfig.json путей нет (он solution-style, одни
   references), а `yaml` приезжает сборкой CommonJS, которую esm-обёртка esbuild
   загрузить не может. */
const out = join(tmpdir(), `prism-validate-${Date.now()}.cjs`)
await esbuild.build({
  entryPoints: ['scripts/validate-config.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: out,
  logLevel: 'warning',

  plugins: [
    {
      name: 'shared-alias',
      setup(build) {
        build.onResolve({ filter: /^@shared\// }, (args) => ({
          path: join(process.cwd(), 'src/shared', `${args.path.slice('@shared/'.length)}.ts`)
        }))
      }
    }
  ]
})
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
process.exit(r.status ?? 1)
