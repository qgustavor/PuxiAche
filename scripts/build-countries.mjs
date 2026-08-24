#!/usr/bin/env bun
// Run this yourself, locally: `bun run build:countries`
//
// This processes a cached source GeoJSON file (src/data/countries.source.geojson)
// to generate the boundary data used by the game.
//
// What it does:
//   1. Reads cached country-boundaries GeoJSON (alpha-2 code + ADMIN name).
//   2. Simplifies each polygon (Douglas-Peucker) to keep bundle size sane.
//   3. Validates polygon winding and computes each country's real area (km²) via Turf.
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
// Tune SIMPLIFY_TOLERANCE if the resulting files are too big/small.
// To update the source data, run: bun run update:countries

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as turf from '@turf/turf'
import { getCountryNames } from './country-names.mjs'

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
const SOURCE_PATH = path.join(OUT_DIR, 'countries.source.geojson')

/**
 * Validates and normalizes polygon winding order (RFC 7946: CCW for outer rings, CW for holes).
 * Ensures the feature has a valid, finite area and throws if it doesn't.
 *
 * @param {Object} feature - GeoJSON feature to validate
 * @param {number} areaThresholdKm2 - Minimum valid area in km²
 * @returns {Object} { geometry: rewound feature, area: area in km² }
 * @throws {Error} if winding is invalid or area is too small/non-finite
 */
function validateAndNormalizeWinding (feature, areaThresholdKm2 = 0.1) {
  // Enforce RFC 7946: CCW for outer rings, CW for holes (reverse: false)
  const rewound = turf.rewind(feature, { reverse: false, mutate: false })
  const area = turf.area(rewound) / 1e6

  if (!Number.isFinite(area)) {
    throw new Error('non-finite area (invalid winding?)')
  }
  if (area < areaThresholdKm2) {
    throw new Error(`area too small: ${area.toFixed(4)}km²`)
  }

  return { geometry: rewound, area }
}

async function main () {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  if (!existsSync(SOURCE_PATH)) {
    throw new Error(
      `Source data not found at ${SOURCE_PATH}\n` +
        'Run `bun run update:countries` to fetch and cache the source GeoJSON.'
    )
  }

  console.log(`Reading ${SOURCE_PATH} ...`)
  const raw = JSON.parse(readFileSync(SOURCE_PATH, 'utf-8'))
  console.log(`Loaded ${raw.features.length} raw features. Processing...`)

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
      // Simplify polygon
      simplified = turf.simplify(feature, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false })

      // Validate winding and compute area on simplified geometry
      const { geometry: validated, area } = validateAndNormalizeWinding(simplified, MIN_AREA_KM2)
      simplified = validated
      areaKm2 = area

      // Verify representative point is actually inside the polygon
      rep = turf.pointOnFeature(simplified)
      if (!turf.booleanPointInPolygon(rep, simplified)) {
        throw new Error('representative point not inside polygon')
      }

      // Create and validate buffer for playable countries
      if (hasRealCode) {
        bufferedFeature = turf.buffer(simplified, BUFFER_KM, { units: 'kilometers' })
        if (!bufferedFeature) throw new Error('buffer returned null')

        // Validate buffered winding and ensure buffer is larger than original
        const { geometry: validatedBuffer, area: bufferedArea } = validateAndNormalizeWinding(bufferedFeature)
        if (bufferedArea <= areaKm2) {
          throw new Error(`buffer area (${bufferedArea.toFixed(2)}km²) not larger than original (${areaKm2.toFixed(2)}km²)`)
        }
        bufferedFeature = validatedBuffer
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
