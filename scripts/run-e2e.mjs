import * as esbuild from 'esbuild'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const out = join(tmpdir(), `prism-e2e-${Date.now()}.cjs`)
await esbuild.build({
  entryPoints: ['scripts/e2e.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: out,
  logLevel: 'warning',
  alias: { electron: join(process.cwd(), 'scripts/electron-stub.mjs') },

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
