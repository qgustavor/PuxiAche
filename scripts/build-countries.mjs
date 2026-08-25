#!/usr/bin/env bun
// This processes a cached source GeoJSON file (src/data/countries.source.geojson)
// to generate the boundary data used by the game.
//
// What it does:
//   1. Reads cached country-boundaries GeoJSON (alpha-2 code + ADMIN name).
//   2. Simplifies each polygon (Douglas-Peucker) to keep bundle size sane (skipped for micro-states).
//   3. Repairs simplification artifacts (self-intersecting bow-ties) via buffer(0) 
//      and drops microscopic islands while strictly preserving the primary landmass.
//   4. Enforces d3-geo winding (CLOCKWISE exterior rings) and explicitly discards 
//      any corrupted sub-polygons that d3-geo interprets as inverted (globe-spanning).
//   5. Scales country operations by size:
//      - Big countries (>= 200,000 km²): Skip the buffer, keeping game logic cheap.
//      - Medium countries: Remove polygon holes, then compute a +500km GEODESIC buffer.
//      - Small countries (< 10,000 km²): Replaced with a simple circle (500km diameter).
//   6. Picks one representative point per country (guaranteed to sit inside
//      the polygon) for the "next country" distance-pacing rule.
//   7. Writes src/data/countries.geo.json, countries.buffered.geo.json and
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
import { geoContains } from 'd3-geo'

// Point Nemo, the oceanic pole of inaccessibility.
// Used strictly as a failsafe to detect inverted spherical polygons that would 
// cause "everywhere is clickable" bugs in-game.
const KNOWN_EMPTY_POINT = [-123.393, -48.876] // [lon, lat] for d3-geo

// The country-code convention used everywhere in this project
const CODE_PROP = 'ISO3166-1-Alpha-2'
const NAME_PROP = 'name'
const SIMPLIFY_TOLERANCE = 0.03 // degrees
const BUFFER_KM = 500

const MIN_AREA_KM2 = 0.1 // drop slivers, but allow micro-states like Vatican (~0.01 km²)
const SKIP_SIMPLIFY_AREA_KM2 = 50 // Skip simplify for tiny nations so we don't erase them

// Country gameplay bounds
const BIG_COUNTRY_AREA = 400000
const SMALL_COUNTRY_AREA = 10000
const SMALL_COUNTRY_RADIUS_KM = 250 // 500km diameter

// Locales to generate country-name translations for.
const NAME_LOCALES = ['pt', 'es']

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')
const SOURCE_PATH = path.join(OUT_DIR, 'countries.source.geojson')

/**
 * Removes holes from a Polygon or MultiPolygon by keeping only the outer ring
 * of each polygon. This avoids math errors when buffering complex shapes.
 */
function removeHoles (feature) {
  const clone = JSON.parse(JSON.stringify(feature))
  const geom = clone.geometry || clone

  if (geom.type === 'Polygon') {
    geom.coordinates = [geom.coordinates[0]]
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates = geom.coordinates.map(poly => [poly[0]])
  }

  return clone
}

/**
 * Re-validates the coordinate structure of a geometry. 
 * Safely filters out collapsed rings and polygons smaller than minAreaKm2.
 * ALWAYS preserves the largest polygon to ensure micro-states are never deleted.
 */
function cleanupGeometry (feature, minAreaKm2) {
  if (!feature || !feature.geometry) return null
  
  const geom = feature.geometry
  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return null

  const validPolys = []
  let maxArea = -1
  let largestPoly = null

  const processPolygon = (rings) => {
    // Outer ring must exist and have at least 4 coordinates
    if (!rings || !rings.length || !rings[0] || rings[0].length < 4) return
    
    // Filter out inner rings (holes) that collapsed during simplification
    const validRings = rings.filter(ring => ring && ring.length >= 4)
    if (validRings.length === 0) return

    try {
      const poly = turf.polygon(validRings)
      const area = turf.area(poly) / 1e6
      
      if (area > maxArea) {
         maxArea = area
         largestPoly = validRings
      }
      if (area >= minAreaKm2) {
         validPolys.push(validRings)
      }
    } catch (e) {
      // Silently ignore structurally invalid sub-polygons
    }
  }

  if (geom.type === 'Polygon') {
    processPolygon(geom.coordinates)
  } else if (geom.type === 'MultiPolygon') {
    for (const rings of geom.coordinates) {
      processPolygon(rings)
    }
  }

  // ALWAYS keep the largest polygon, even if it's smaller than minAreaKm2.
  // This completely prevents micro-states (like the Vatican) from disappearing.
  if (validPolys.length === 0 && largestPoly) {
    validPolys.push(largestPoly)
  }

  if (validPolys.length === 0) return null

  const clone = JSON.parse(JSON.stringify(feature))
  if (validPolys.length === 1) {
    clone.geometry.type = 'Polygon'
    clone.geometry.coordinates = validPolys[0]
  } else {
    clone.geometry.type = 'MultiPolygon'
    clone.geometry.coordinates = validPolys
  }

  return clone
}

/**
 * Isolates and discards specific corrupted sub-polygons that d3-geo evaluates as inverted.
 * This targets the "Indonesia archipelago bug" without failing the entire build.
 */
function filterInvertedPolygons (feature, contextName) {
  const clone = JSON.parse(JSON.stringify(feature))
  const geom = clone.geometry || clone

  if (geom.type === 'Polygon') {
    if (geoContains(clone, KNOWN_EMPTY_POINT)) {
      console.warn(`    [!] Dropped entire polygon for ${contextName}: inverted spherical winding`)
      return null
    }
    return clone
  } else if (geom.type === 'MultiPolygon') {
    const validPolys = []
    let dropped = 0

    for (const rings of geom.coordinates) {
      const testFeature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: rings }, properties: {} }
      if (!geoContains(testFeature, KNOWN_EMPTY_POINT)) {
        validPolys.push(rings)
      } else {
        dropped++
      }
    }
    
    if (validPolys.length === 0) {
      console.warn(`    [!] Dropped ALL sub-polygons for ${contextName}: all inverted`)
      return null
    }
    
    if (dropped > 0) {
      console.warn(`    [!] Dropped ${dropped} inverted sub-polygon(s) for ${contextName}`)
      if (validPolys.length === 1) {
        geom.type = 'Polygon'
        geom.coordinates = validPolys[0]
      } else {
        geom.coordinates = validPolys
      }
    }
    return clone
  }
  return clone
}

/**
 * Strict final sanity check to prevent bad data from ever reaching production.
 */
function assertValidSphericalPolygon (feature, contextMsg) {
  if (geoContains(feature, KNOWN_EMPTY_POINT)) {
    console.error(`\n======================================================`)
    console.error(`FATAL ERROR: Spherical winding sanity check failed!`)
    console.error(`Geometry for ${contextMsg} covers Point Nemo.`)
    console.error(`This indicates an inverted polygon that would break the game.`)
    console.error(`Aborting build to prevent deploying bad data.`)
    console.error(`======================================================\n`)
    process.exit(1)
  }
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
    const hasRealCode = !!rawCode && rawCode !== '-99'
    const code = hasRealCode ? rawCode : `UNPLAYABLE_${unplayableIndex++}`

    let simplified
    let areaKm2
    let rep
    let bufferedFeature
    
    try {
      const rawAreaKm2 = turf.area(feature) / 1e6

      // 1. Simplify polygon (skip for micro-states like Vatican to avoid completely destroying them)
      if (rawAreaKm2 < SKIP_SIMPLIFY_AREA_KM2) {
        simplified = JSON.parse(JSON.stringify(feature))
      } else {
        simplified = turf.simplify(feature, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false })
      }
      
      // 2. Standard GIS trick: buffer(0) dissolves self-intersections/bow-ties caused by simplify
      try {
        const unkinked = turf.buffer(simplified, 0, { units: 'kilometers' })
        if (unkinked && (unkinked.geometry.type === 'Polygon' || unkinked.geometry.type === 'MultiPolygon')) {
          simplified = unkinked
        }
      } catch (e) {
        // Silently fallback to raw simplified geometry if JSTS throws
      }

      // 3. Clean up microscopic remnants (islands smaller than MIN_AREA_KM2)
      simplified = cleanupGeometry(simplified, MIN_AREA_KM2)
      if (!simplified) throw new Error('geometry completely collapsed after simplification')

      // 4. Force d3-geo winding (CLOCKWISE exterior rings).
      // `reverse: true` explicitly creates CW rings, which d3-geo interprets as localized 
      // regions. Default (CCW) is interpreted as "covering the rest of the Earth".
      simplified = turf.rewind(simplified, { reverse: true, mutate: false })

      // 5. Catch and discard any sub-polygons that STILL act as inverted spheres
      simplified = filterInvertedPolygons(simplified, `${nameEn} (visual boundary)`)
      if (!simplified) throw new Error('all sub-polygons were inverted and dropped')

      // 6. Absolute final failsafe
      assertValidSphericalPolygon(simplified, `${nameEn} (visual boundary)`)

      areaKm2 = turf.area(simplified) / 1e6
      if (!Number.isFinite(areaKm2)) throw new Error('non-finite area')
      if (areaKm2 <= 0) throw new Error('area is zero or negative')
      
      // Only strictly enforce minimum area constraints on unplayable map artifacts.
      // If it has a real ISO code (like the Vatican), we want it in the game!
      if (areaKm2 < MIN_AREA_KM2 && !hasRealCode) {
        throw new Error(`area too small: ${areaKm2.toFixed(4)}km²`)
      }

      // Verify representative point is actually inside the polygon
      rep = turf.pointOnFeature(simplified)
      if (!turf.booleanPointInPolygon(rep, simplified)) {
        throw new Error('representative point not inside polygon')
      }

      // Handle hit-box operations based on country sizes
      if (hasRealCode) {
        if (areaKm2 >= BIG_COUNTRY_AREA) {
          // A. Big Countries: Do not buffer
          bufferedFeature = JSON.parse(JSON.stringify(simplified))
        } else if (areaKm2 < SMALL_COUNTRY_AREA) {
          // B. Small Countries: Approximate to a simple circle
          bufferedFeature = turf.circle(rep, SMALL_COUNTRY_RADIUS_KM, { units: 'kilometers', steps: 64 })
          bufferedFeature = turf.rewind(bufferedFeature, { reverse: true, mutate: false })
          bufferedFeature = filterInvertedPolygons(bufferedFeature, `${nameEn} (small circle)`)
          assertValidSphericalPolygon(bufferedFeature, `${nameEn} (small circle)`)
        } else {
          // C. Middle-Sized Countries: Remove holes, then buffer
          const noHoles = removeHoles(simplified)
          bufferedFeature = turf.buffer(noHoles, BUFFER_KM, { units: 'kilometers' })
          
          // Turf buffer sometimes creates tiny artifacts; buffer(0) safely dissolves them
          try {
            const unkinkedBuf = turf.buffer(bufferedFeature, 0, { units: 'kilometers' })
            if (unkinkedBuf && (unkinkedBuf.geometry.type === 'Polygon' || unkinkedBuf.geometry.type === 'MultiPolygon')) {
              bufferedFeature = unkinkedBuf
            }
          } catch(e) {}
          
          bufferedFeature = cleanupGeometry(bufferedFeature, 1) || bufferedFeature
          bufferedFeature = turf.rewind(bufferedFeature, { reverse: true, mutate: false })
          
          // Fallback mechanism: Turf planar buffers across the Antimeridian (like Fiji) 
          // usually produce garbage geometries that evaluate as inverted.
          bufferedFeature = filterInvertedPolygons(bufferedFeature, `${nameEn} (buffered hit-box)`)
          
          if (!bufferedFeature) {
            console.warn(`    [!] Turf buffer failed (likely antimeridian crossing) for ${nameEn}. Falling back to 500km circle.`)
            bufferedFeature = turf.circle(rep, BUFFER_KM, { units: 'kilometers', steps: 64 }) // Generous 500km radius fallback
            bufferedFeature = turf.rewind(bufferedFeature, { reverse: true, mutate: false })
            bufferedFeature = filterInvertedPolygons(bufferedFeature, `${nameEn} (fallback circle)`)
            if (!bufferedFeature) throw new Error('Fallback circle also inverted')
            assertValidSphericalPolygon(bufferedFeature, `${nameEn} (fallback circle)`)
          } else {
            assertValidSphericalPolygon(bufferedFeature, `${nameEn} (buffered hit-box)`)
          }
        }
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
