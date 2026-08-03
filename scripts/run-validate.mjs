/* Собирает validate-config.ts через esbuild (он и так есть в зависимостях vite) и запускает. */
import * as esbuild from 'esbuild'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const out = join(tmpdir(), `prism-validate-${Date.now()}.mjs`)
await esbuild.build({
  entryPoints: ['scripts/validate-config.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  logLevel: 'warning'
})
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
process.exit(r.status ?? 1)
