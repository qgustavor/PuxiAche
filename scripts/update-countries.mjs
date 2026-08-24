#!/usr/bin/env bun
// Update the cached source country boundaries GeoJSON.
// Run this occasionally to refresh data: `bun run update:countries`
//
// This downloads the latest countries.geojson from the datasets/geo-countries
// repository and caches it locally so build:countries can process it without
// needing network access during deployment.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SOURCE_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/main/data/countries.geojson'
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')
const OUT_PATH = path.join(OUT_DIR, 'countries.source.geojson')

async function main () {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  console.log(`Fetching ${SOURCE_URL} ...`)
  const res = await fetch(SOURCE_URL)
  if (!res.ok) {
    throw new Error(
      `Failed to fetch source dataset (HTTP ${res.status}).\n` +
        'Try again later or check the URL if it has changed.'
    )
  }
  const data = await res.json()
  console.log(`Fetched ${data.features.length} features.`)

  writeFileSync(OUT_PATH, JSON.stringify(data))
  console.log(`Cached to ${OUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
