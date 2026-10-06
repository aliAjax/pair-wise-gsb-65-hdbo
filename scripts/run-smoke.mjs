// Node 运行环境垫片 + esbuild 即时转译，运行 scripts/smoke.mts
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// localStorage 垫片（zustand persist / storage 故障开关使用）
const memory = new Map()
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear()
}

const result = await build({
  entryPoints: ['scripts/smoke.mts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent'
})
const dir = mkdtempSync(join(tmpdir(), 'gsb65-smoke-'))
const out = join(dir, 'smoke.mjs')
writeFileSync(out, result.outputFiles[0].text)
await import(pathToFileURL(out).href)
