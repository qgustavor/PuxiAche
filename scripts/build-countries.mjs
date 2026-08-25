#!/usr/bin/env bun
// This processes a cached source GeoJSON file (src/data/countries.source.geojson)
// to generate the boundary data used by the game.
//
// Reads a raw country-boundaries GeoJSON and produces three files under
// src/data/: simplified visual boundaries (countries.geo.json), a buffered
// "hit-box" version used for click/tap detection (countries.buffered.geo.json),
// and per-country metadata like name translations and area (countries.meta.json).
// Geometry is validated against d3-geo along the way, since a corrupted or
// inverted polygon would make the wrong parts of the globe clickable in-game.
//
// To update the source data, run: bun run update:countries

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as turf from '@turf/turf'
import { getCountryNames } from './country-names.mjs'
import { geoContains } from 'd3-geo'

const KNOWN_EMPTY_POINT = [-123.393, -48.876] // [lon, lat] Point Nemo

const CODE_PROP = 'ISO3166-1-Alpha-2'
const NAME_PROP = 'name'
const SIMPLIFY_TOLERANCE = 0.08 // degrees

// Game Design parameters
const BUFFER_KM = 500
const SMALL_COUNTRY_AREA = 1000 // < 1,000 km²: approximate to circle
const SMALL_COUNTRY_RADIUS_KM = 500
const CIRCLE_STEPS = 48

// Filters out tiny uninhabited archipelago rocks (<50 km²) so they don't spawn
// stray 500km bubbles in the deep ocean. Micro-states are always preserved.
const MIN_AREA_KM2 = 50 
const SKIP_SIMPLIFY_AREA_KM2 = 50

const NAME_LOCALES = ['pt', 'es']

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')
const SOURCE_PATH = path.join(OUT_DIR, 'countries.source.geojson')

function truncateCoordinates (feature, precision = 3) {
  const factor = 10 ** precision
  turf.coordEach(feature, (coord) => {
    coord[0] = Math.round(coord[0] * factor) / factor
    coord[1] = Math.round(coord[1] * factor) / factor
  })
  return feature
}

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
 * Rotates every coordinate's longitude by 180 degrees, mapping [-180, 180]
 * onto itself. For a country whose landmass straddles the antimeridian, this
 * moves its seam to longitude 0 — an ordinary value with no wraparound —
 * so it can be buffered and later split with a plain bounding-box clip
 * instead of one that has to reason about the [-180, 180] wraparound.
 */
function rotateLongitude180 (feature) {
  const clone = JSON.parse(JSON.stringify(feature))
  turf.coordEach(clone, c => {
    c[0] = c[0] > 0 ? c[0] - 180 : c[0] + 180
  })
  return clone
}

/**
 * Undoes rotateLongitude180 on a buffered, rotated shape: splits it at
 * longitude 0 (its seam in the rotated frame) and rotates each half back,
 * producing valid standard GeoJSON where the seam sits at ±180 again.
 */
function unrotateAndSplit (feature) {
  let west = null
  let east = null
  try { west = turf.bboxClip(feature, [-180, -90, 0, 90]) } catch (e) {}
  try { east = turf.bboxClip(feature, [0, -90, 180, 90]) } catch (e) {}

  const polys = []
  // Each piece's clip boundary sits exactly at rotated longitude 0, which
  // belongs to both pieces at once. Shifting by sign (as rotateLongitude180
  // does) is ambiguous there — the west clip's boundary correctly needs +180,
  // but the east clip's own boundary needs -180, and a sign check on the
  // coordinate alone can't tell those apart. Since we already know which
  // clip produced which piece, shift each one unconditionally instead.
  const collect = (clipped, shiftDeg) => {
    if (!clipped || !clipped.geometry) return
    const shifted = JSON.parse(JSON.stringify(clipped))
    turf.coordEach(shifted, c => { c[0] += shiftDeg })
    const ringSets = shifted.geometry.type === 'Polygon'
      ? [shifted.geometry.coordinates]
      : shifted.geometry.type === 'MultiPolygon'
        ? shifted.geometry.coordinates
        : []
    for (const rings of ringSets) {
      if (rings[0] && rings[0].length >= 4) polys.push(rings)
    }
  }
  collect(west, 180)
  collect(east, -180)

  if (polys.length === 0) return null

  const result = JSON.parse(JSON.stringify(feature))
  if (polys.length === 1) {
    result.geometry.type = 'Polygon'
    result.geometry.coordinates = polys[0]
  } else {
    result.geometry.type = 'MultiPolygon'
    result.geometry.coordinates = polys
  }
  return result
}

// Fraction of a country's total component area a secondary landmass must
// reach to be kept when reducing to significant landmasses; the largest
// polygon is always kept regardless of this threshold.
const SIGNIFICANT_LANDMASS_FRACTION = 0.01

/**
 * Reduces a Polygon/MultiPolygon to its significant landmasses: the largest
 * component is always kept, and any other component is kept only if its area
 * is at least `fraction` of the total. Used to keep hitbox buffering focused
 * on a country's meaningful territory rather than every remote islet.
 */
function reduceToSignificantLandmasses (feature, fraction = SIGNIFICANT_LANDMASS_FRACTION) {
  if (!feature || !feature.geometry) return null
  if (feature.geometry.type === 'Polygon') return feature
  if (feature.geometry.type !== 'MultiPolygon') return null

  const components = []
  let totalArea = 0

  for (const rings of feature.geometry.coordinates) {
    if (!rings || !rings[0] || rings[0].length < 4) continue
    try {
      const area = turf.area(turf.polygon(rings))
      components.push({ rings, area })
      totalArea += area
    } catch (e) {}
  }

  if (components.length === 0) return null

  components.sort((a, b) => b.area - a.area)
  const kept = components.filter((c, i) => i === 0 || c.area >= totalArea * fraction)

  const clone = JSON.parse(JSON.stringify(feature))
  if (kept.length === 1) {
    clone.geometry.type = 'Polygon'
    clone.geometry.coordinates = kept[0].rings
  } else {
    clone.geometry.type = 'MultiPolygon'
    clone.geometry.coordinates = kept.map(c => c.rings)
  }
  return clone
}

// How close a component's raw longitude extent must come to +/-180 before we
// treat it as antimeridian-adjacent. Needs to comfortably cover how far a
// BUFFER_KM buffer can push a coastline in longitude degrees, which grows at
// higher latitudes (a fixed km distance spans more longitude near the poles).
const ANTIMERIDIAN_MARGIN_DEG = 30

// A component wider than this (in longitude degrees) is split into narrower
// bands before buffering. Turf's buffer flattens a shape into a single planar
// projection, which distorts badly across a very wide span — splitting keeps
// each piece buffered accurately, and also keeps whichever band ends up near
// the antimeridian small enough for the rotation-and-split logic to handle.
const MAX_COMPONENT_LON_SPAN_DEG = 50

/**
 * Splits a polygon's coordinate rings into narrower longitude bands if its
 * span exceeds maxSpanDeg. Returns an array of ring-sets (one per band), or
 * the original rings unchanged, wrapped in an array, if no split is needed.
 */
function splitIntoLonBands (rings, maxSpanDeg) {
  let minLon = Infinity
  let maxLon = -Infinity
  for (const point of rings[0]) {
    if (point[0] < minLon) minLon = point[0]
    if (point[0] > maxLon) maxLon = point[0]
  }
  const span = maxLon - minLon
  if (span <= maxSpanDeg) return [rings]

  const bandCount = Math.ceil(span / maxSpanDeg)
  const bandWidth = span / bandCount
  const feature = turf.polygon(rings)
  const bands = []

  for (let i = 0; i < bandCount; i++) {
    const lo = minLon + i * bandWidth
    const hi = i === bandCount - 1 ? maxLon : lo + bandWidth
    try {
      const clipped = turf.bboxClip(feature, [lo, -90, hi, 90])
      const ringSets = clipped?.geometry?.type === 'Polygon'
        ? [clipped.geometry.coordinates]
        : clipped?.geometry?.type === 'MultiPolygon'
          ? clipped.geometry.coordinates
          : []
      for (const bandRings of ringSets) {
        if (bandRings[0] && bandRings[0].length >= 4) bands.push(bandRings)
      }
    } catch (e) {}
  }

  return bands.length > 0 ? bands : [rings]
}

/**
 * Buffers an entire country as one combined shape: all landmass components
 * (after band-splitting any that are individually too wide) are merged into
 * a single Polygon/MultiPolygon, rotated together if the combined extent
 * comes close to the antimeridian, buffered in one pass, then split back
 * into standard GeoJSON. Buffering everything together in one call lets
 * Turf's own multi-part buffer fuse nearby landmasses natively — buffering
 * components independently and unioning the results afterward can bridge
 * antimeridian-split pieces with spurious edges, since two independently
 * split shapes being merged don't share a consistent seam.
 * Antarctica wraps around the pole rather than crossing the antimeridian in
 * the usual sense, so it's buffered directly without any of this handling.
 * When `diagnostics` is provided, a record of the outcome is appended to it.
 */
function bufferCountry (feature, bufferKm, code, diagnostics) {
  if (code === 'AQ') {
    try {
      return turf.buffer(feature, bufferKm, { units: 'kilometers' })
    } catch (e) {
      return null
    }
  }

  const geom = feature.geometry
  const rawComponents = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  const components = rawComponents.flatMap(rings => splitIntoLonBands(rings, MAX_COMPONENT_LON_SPAN_DEG))
  if (components.length === 0) return null

  const combined = {
    type: 'Feature',
    properties: {},
    geometry: components.length === 1
      ? { type: 'Polygon', coordinates: components[0] }
      : { type: 'MultiPolygon', coordinates: components }
  }

  let minLon = Infinity
  let maxLon = -Infinity
  turf.coordEach(combined, c => {
    if (c[0] < minLon) minLon = c[0]
    if (c[0] > maxLon) maxLon = c[0]
  })
  const needsRotation = minLon < -180 + ANTIMERIDIAN_MARGIN_DEG || maxLon > 180 - ANTIMERIDIAN_MARGIN_DEG
  const record = { minLon, maxLon, needsRotation, outcome: 'ok' }
  if (diagnostics) diagnostics.push(record)

  const working = needsRotation ? rotateLongitude180(combined) : combined

  let buf
  try {
    buf = turf.buffer(working, bufferKm, { units: 'kilometers' })
  } catch (e) {
    record.outcome = `buffer threw: ${e.message}`
    return null
  }
  if (!buf) {
    record.outcome = 'buffer returned nothing'
    return null
  }

  // Cleanup self-intersections while the shape is still in whatever frame it
  // was just buffered in (rotated or not), before any antimeridian split.
  // Doing this after splitting would run it on a MultiPolygon whose pieces
  // sit hundreds of degrees apart numerically, even though they're geographic
  // neighbors across the seam.
  try {
    const unkinked = turf.buffer(buf, 0, { units: 'kilometers' })
    if (unkinked && unkinked.geometry) buf = unkinked
  } catch (e) {}

  if (needsRotation) {
    buf = unrotateAndSplit(buf)
    if (!buf) {
      record.outcome = 'unrotateAndSplit returned nothing'
      return null
    }
  }

  return buf
}

function cleanupGeometry (feature, minAreaKm2) {
  if (!feature || !feature.geometry) return null
  
  const geom = feature.geometry
  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return null

  const validPolys = []
  let maxArea = -1
  let largestPoly = null

  const processPolygon = (rings) => {
    if (!rings || !rings.length || !rings[0] || rings[0].length < 4) return
    
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
    } catch (e) {}
  }

  if (geom.type === 'Polygon') {
    processPolygon(geom.coordinates)
  } else if (geom.type === 'MultiPolygon') {
    for (const rings of geom.coordinates) {
      processPolygon(rings)
    }
  }

  // ALWAYS retain largest polygon so micro-states are never wiped
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
    const droppedDetails = []

    for (const rings of geom.coordinates) {
      const testFeature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: rings }, properties: {} }
      if (!geoContains(testFeature, KNOWN_EMPTY_POINT)) {
        validPolys.push(rings)
      } else {
        dropped++
        try {
          const bbox = turf.bbox(testFeature)
          const area = Math.round(turf.area(testFeature) / 1e6)
          droppedDetails.push(`lon ${bbox[0].toFixed(1)}..${bbox[2].toFixed(1)}, ~${area}km²`)
        } catch (e) {
          droppedDetails.push('(unmeasurable)')
        }
      }
    }
    
    if (validPolys.length === 0) {
      console.warn(`    [!] Dropped ALL sub-polygons for ${contextName}: all inverted`)
      return null
    }
    
    if (dropped > 0) {
      const keptDetails = validPolys.map(rings => {
        const testFeature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: rings }, properties: {} }
        try {
          const bbox = turf.bbox(testFeature)
          const area = Math.round(turf.area(testFeature) / 1e6)
          return `lon ${bbox[0].toFixed(1)}..${bbox[2].toFixed(1)}, ~${area}km²`
        } catch (e) {
          return '(unmeasurable)'
        }
      })
      console.warn(
        `    [!] Dropped ${dropped} inverted sub-polygon(s) for ${contextName}: ${droppedDetails.join('; ')}. ` +
        `Kept: ${keptDetails.join('; ')}`
      )
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

function assertValidSphericalPolygon (feature, contextMsg) {
  if (geoContains(feature, KNOWN_EMPTY_POINT)) {
    console.error('\n======================================================')
    console.error('FATAL ERROR: Spherical winding sanity check failed!')
    console.error(`Geometry for ${contextMsg} covers Point Nemo.`)
    console.error('Aborting build to prevent deploying bad data.')
    console.error('======================================================\n')
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

      if (rawAreaKm2 < SKIP_SIMPLIFY_AREA_KM2) {
        simplified = JSON.parse(JSON.stringify(feature))
      } else {
        simplified = turf.simplify(feature, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false })
      }
      
      try {
        const unkinked = turf.buffer(simplified, 0, { units: 'kilometers' })
        if (unkinked && (unkinked.geometry.type === 'Polygon' || unkinked.geometry.type === 'MultiPolygon')) {
          simplified = unkinked
        }
      } catch (e) {}

      simplified = cleanupGeometry(simplified, MIN_AREA_KM2)
      if (!simplified) throw new Error('geometry completely collapsed after simplification')

      simplified = turf.rewind(simplified, { reverse: true, mutate: false })
      simplified = filterInvertedPolygons(simplified, `${nameEn} (visual boundary)`)
      if (!simplified) throw new Error('all sub-polygons were inverted and dropped')

      assertValidSphericalPolygon(simplified, `${nameEn} (visual boundary)`)
      simplified = truncateCoordinates(simplified, 3)

      areaKm2 = turf.area(simplified) / 1e6
      if (!Number.isFinite(areaKm2)) throw new Error('non-finite area')
      if (areaKm2 <= 0) throw new Error('area is zero or negative')
      
      if (areaKm2 < 0.01 && !hasRealCode) {
        throw new Error(`area too small: ${areaKm2.toFixed(4)}km²`)
      }

      rep = turf.pointOnFeature(simplified)
      if (!turf.booleanPointInPolygon(rep, simplified)) {
        throw new Error('representative point not inside polygon')
      }

      if (hasRealCode) {
        if (areaKm2 < SMALL_COUNTRY_AREA) {
          // Small micro-states: 500km circle around centroid
          bufferedFeature = turf.circle(rep, SMALL_COUNTRY_RADIUS_KM, { units: 'kilometers', steps: CIRCLE_STEPS })
          bufferedFeature = turf.rewind(bufferedFeature, { reverse: true, mutate: false })
          bufferedFeature = filterInvertedPolygons(bufferedFeature, `${nameEn} (small circle)`)
          assertValidSphericalPolygon(bufferedFeature, `${nameEn} (small circle)`)
        } else {
          // Medium and large countries: 500km buffer over the significant landmasses,
          // seamlessly fused into one hitbox
          const noHoles = removeHoles(simplified)
          const significant = reduceToSignificantLandmasses(noHoles)
          const bufferDiagnostics = []
          bufferedFeature = significant ? bufferCountry(significant, BUFFER_KM, code, bufferDiagnostics) : null
          const rawShape = bufferedFeature
            ? `${bufferedFeature.geometry.type} with ${bufferedFeature.geometry.type === 'MultiPolygon' ? bufferedFeature.geometry.coordinates.length : 1} part(s)`
            : 'nothing'
          const formatDiagnostic = d => `[${d.minLon.toFixed(1)}..${d.maxLon.toFixed(1)}${d.needsRotation ? ' rotated' : ''}: ${d.outcome}]`
          const problems = bufferDiagnostics.filter(d => d.outcome !== 'ok')

          if (bufferedFeature) {
            bufferedFeature = cleanupGeometry(bufferedFeature, 1) || bufferedFeature
            bufferedFeature = turf.rewind(bufferedFeature, { reverse: true, mutate: false })
            bufferedFeature = filterInvertedPolygons(bufferedFeature, `${nameEn} (buffered hit-box)`)
          }

          if (bufferedFeature && problems.length > 0) {
            console.warn(
              `    [!] ${nameEn} buffered hit-box succeeded but had issues (${bufferDiagnostics.length} components): ` +
              `${bufferDiagnostics.map(formatDiagnostic).join(' ')}. Raw merge was ${rawShape}.`
            )
          }

          if (!bufferedFeature) {
            console.warn(
              `    [!] Buffer failed for ${nameEn} (${bufferDiagnostics.length} components): ` +
              `${bufferDiagnostics.map(formatDiagnostic).join(' ')}. ` +
              `Raw merge was ${rawShape}. Falling back to 500km circle.`
            )
            bufferedFeature = turf.circle(rep, SMALL_COUNTRY_RADIUS_KM, { units: 'kilometers', steps: CIRCLE_STEPS })
            bufferedFeature = turf.rewind(bufferedFeature, { reverse: true, mutate: false })
            bufferedFeature = filterInvertedPolygons(bufferedFeature, `${nameEn} (fallback circle)`)
            if (!bufferedFeature) throw new Error('Fallback circle also inverted')
            assertValidSphericalPolygon(bufferedFeature, `${nameEn} (fallback circle)`)
          } else {
            assertValidSphericalPolygon(bufferedFeature, `${nameEn} (buffered hit-box)`)
          }
        }
        bufferedFeature = truncateCoordinates(bufferedFeature, 3)
      }
    } catch (err) {
      console.warn(`  skipping ${nameEn} (${rawCode}): ${err.message}`)
      skipped += 1
      continue
    }

    const [lon, lat] = rep.geometry.coordinates
    simplified.properties = { code }
    boundaries.features.push(simplified)

    if (!hasRealCode) continue

    bufferedFeature.properties = { code }
    buffered.features.push(bufferedFeature)
    meta.push({
      code,
      en: nameEn,
      ...getCountryNames(code, nameEn, NAME_LOCALES),
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      area: Math.round(areaKm2),
    })
  }

  writeFileSync(path.join(OUT_DIR, 'countries.geo.json'), JSON.stringify(boundaries))
  writeFileSync(path.join(OUT_DIR, 'countries.buffered.geo.json'), JSON.stringify(buffered))
  writeFileSync(path.join(OUT_DIR, 'countries.meta.json'), JSON.stringify(meta))

  console.log(`\nWrote ${meta.length} countries to src/data/ (skipped ${skipped}).`)
  console.log('countries.geo.json + countries.buffered.geo.json + countries.meta.json are ready.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
