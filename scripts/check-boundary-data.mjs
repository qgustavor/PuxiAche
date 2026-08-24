#!/usr/bin/env bun
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')
const metaPath = path.join(dataDir, 'countries.meta.json')
const geoPath = path.join(dataDir, 'countries.geo.json')
const bufferedPath = path.join(dataDir, 'countries.buffered.geo.json')

function fail (message) {
  console.error(`\n❌ ${message}\n`)
  process.exit(1)
}

for (const p of [metaPath, geoPath, bufferedPath]) {
  if (!existsSync(p)) {
    fail(
      `Swipe the Globe: expected data file is missing: ${path.relative(process.cwd(), p)}\n` +
        '  Run `npm run build:countries` first (needs network access).'
    )
  }
}

let meta
let geo
try {
  meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
  geo = JSON.parse(readFileSync(geoPath, 'utf-8'))
} catch (err) {
  fail(`Swipe the Globe: could not parse boundary data files: ${err.message}`)
}

if (!Array.isArray(meta) || meta.length === 0 || !geo.features || geo.features.length === 0) {
  fail(
    'Swipe the Globe: country boundary data has not been generated yet.\n' +
      '  Run `npm run build:countries` first (needs network access), then try again.'
  )
}

console.log(`✓ Boundary data present (${meta.length} countries).`)
