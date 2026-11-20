import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
await build({
  absWorkingDir: root,
  stdin: {
    contents: `
      export { buildConfig } from './src/shared/config-builder'
      export { DEFAULT_SETTINGS, DEFAULT_ENABLED_PRESETS } from './src/shared/defaults'
      export { nodeKey, parseLink, parsedToNode } from './src/shared/parsers'
      export { PRESETS } from './src/shared/presets'
      export { parseSubscriptionBody } from './src/shared/subscriptions'
    `,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  minify: true,
  target: 'es2020',
  format: 'iife',
  globalName: 'PrismShared',
  banner: { js: readFileSync(new URL('./jsc-polyfills.js', import.meta.url), 'utf8') },
  outfile: 'android/app/src/main/assets/shared.js'
})
