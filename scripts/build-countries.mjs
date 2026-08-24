#!/usr/bin/env bun
// Run this yourself, locally: `bun run scripts/build-countries.mjs`
//
// This needs network access (it fetches a public GeoJSON dataset) — it is
// NOT run as part of `npm install` or `npm run build`, on purpose, so the
// project stays buildable offline with the (less accurate) fallback data
// that ships in src/data/countries.js.
//
// What it does:
//   1. Downloads a world country-boundaries GeoJSON (alpha-2 code + ADMIN name).
//   2. Simplifies each polygon (Douglas-Peucker) to keep bundle size sane.
//   3. Computes each country's real area (km²) via Turf.
//   4. Computes a +500km GEODESIC buffer of each polygon via Turf — this is
//      the "found within 500km of the border" tolerance from the game
//      design, and it's why we use Turf here instead of Clipper2: Turf's
//      buffer works in real kilometers on the sphere, so it behaves
//      correctly near the poles and near the antimeridian. Clipper2 is a
//      planar polygon-clipping library — great for offsetting shapes in a
//      flat coordinate space, but it has no concept of "kilometers on a
//      sphere", so a naive degree-based offset would be badly wrong at
//      high latitudes (a degree of longitude is ~111km at the equator but
//      ~0km at the poles).
//   5. Picks one representative point per country (guaranteed to sit inside
//      the polygon) for the "next country" distance-pacing rule.
//   6. Writes src/data/countries.geo.json, countries.buffered.geo.json and
//      countries.meta.json. The app auto-detects these and switches from
//      circle-approximation mode to real boundary+buffer mode.
//
// Tune SIMPLIFY_TOLERANCE if the resulting files are too big/small, or
// swap SOURCE_URL for a different dataset (Natural Earth 50m/110m, etc.) —
// just check the property names line up with CODE_PROP / NAME_PROP below.

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as turf from '@turf/turf'
import { getCountryNames } from './country-names.mjs'

const SOURCE_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/main/data/countries.geojson'
// The country-code convention used everywhere in this project: boundary/buffer features,
// countries.meta.json, and game logic all key off alpha-2 codes, and Intl.DisplayNames
// (scripts/country-names.mjs) takes alpha-2 codes directly.
const CODE_PROP = 'ISO3166-1-Alpha-2'
const NAME_PROP = 'name'
const SIMPLIFY_TOLERANCE = 0.03 // degrees
const BUFFER_KM = 500
const MIN_AREA_KM2 = 1 // drop slivers/invalid features
// Which languages to generate country-name translations for. The source GeoJSON's `name`
// property is used as-is for 'en' (it's already curated); every other locale is generated
// via Intl.DisplayNames (see scripts/country-names.mjs). Add a locale code here — and to
// SUPPORTED_LANGS in src/i18n.js, with a matching src/locales/<code>.json — to add a
// language; see CONTRIBUTING.md.
const NAME_LOCALES = ['pt', 'es']

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')

async function main () {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  console.log(`Fetching ${SOURCE_URL} ...`)
  const res = await fetch(SOURCE_URL)
  if (!res.ok) {
    throw new Error(
      `Failed to fetch source dataset (HTTP ${res.status}). ` +
        'You can also download a GeoJSON yourself and point SOURCE_URL at a local file:// URL.'
    )
  }
  const raw = await res.json()
  console.log(`Fetched ${raw.features.length} raw features. Processing...`)

  const boundaries = { type: 'FeatureCollection', features: [] }
  const buffered = { type: 'FeatureCollection', features: [] }
  const meta = []
  let skipped = 0

  let unplayableIndex = 0
  for (const feature of raw.features) {
    const rawCode = feature.properties?.[CODE_PROP]
    const nameEn = feature.properties?.[NAME_PROP] || rawCode
    // Some features (e.g. disputed territories) have no ISO code (-99). We still
    // want them drawn on the globe for a complete-looking world map, they just
    // aren't eligible to be picked as a "find this country" target, so they get
    // a synthetic, unplayable code and are left out of countries.meta.json.
    const hasRealCode = !!rawCode && rawCode !== '-99'
    const code = hasRealCode ? rawCode : `UNPLAYABLE_${unplayableIndex++}`

    let simplified
    let areaKm2
    let rep
    let bufferedFeature
    try {
      simplified = turf.simplify(feature, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false })
      simplified = turf.rewind(simplified, { reverse: true, mutate: true })
      areaKm2 = turf.area(feature) / 1e6
      if (!Number.isFinite(areaKm2) || areaKm2 < MIN_AREA_KM2) throw new Error('invalid area')
      rep = turf.pointOnFeature(feature)
      if (hasRealCode) {
        bufferedFeature = turf.buffer(simplified, BUFFER_KM, { units: 'kilometers' })
        if (!bufferedFeature) throw new Error('buffer returned null')
        bufferedFeature = turf.rewind(bufferedFeature, { reverse: true, mutate: true })
      }
    } catch (err) {
      console.warn(`  skipping ${nameEn} (${rawCode}): ${err.message}`)
      skipped += 1
      continue
    }

    const [lon, lat] = rep.geometry.coordinates
    simplified.properties = { code }
    boundaries.features.push(simplified)

    if (!hasRealCode) continue // drawn on the globe, but not playable/findable

    bufferedFeature.properties = { code }
    buffered.features.push(bufferedFeature)
    meta.push({
      code,
      en: nameEn,
      ...getCountryNames(code, nameEn, NAME_LOCALES),
      lat,
      lon,
      area: Math.round(areaKm2),
    })
  }

  writeFileSync(path.join(OUT_DIR, 'countries.geo.json'), JSON.stringify(boundaries))
  writeFileSync(path.join(OUT_DIR, 'countries.buffered.geo.json'), JSON.stringify(buffered))
  writeFileSync(path.join(OUT_DIR, 'countries.meta.json'), JSON.stringify(meta, null, 2))

  console.log(`\nWrote ${meta.length} countries to src/data/ (skipped ${skipped}).`)
  console.log('countries.geo.json + countries.buffered.geo.json + countries.meta.json are ready.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
