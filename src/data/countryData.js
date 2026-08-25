import { geoContains } from 'd3-geo'
import boundariesGeo from './countries.geo.json'
import bufferedGeo from './countries.buffered.geo.json'
import meta from './countries.meta.json'

if (meta.length === 0 || boundariesGeo.features.length === 0) {
  throw new Error(
    'PuxiAche: country boundary data is missing (src/data/countries.*.json ' +
      'are empty). Run `npm run build:countries` (needs network access) ' +
      'before starting the dev server or building. See README.md.'
  )
}

const boundaryByCode = new Map(boundariesGeo.features.map((f) => [f.properties.code, f]))
const bufferedByCode = new Map(bufferedGeo.features.map((f) => [f.properties.code, f]))

/** Normalized list of countries for gameplay: [{ code, en, pt, lat, lon, area }]. */
export const COUNTRY_LIST = meta

/** Every boundary feature to draw on the globe, including unplayable territories with no ISO code. */
export const ALL_BOUNDARY_FEATURES = boundariesGeo.features

export function getBoundaryFeature (code) {
  return boundaryByCode.get(code) || null
}

/**
 * Returns true if the given lat/lon falls inside the country's +500km buffered boundary.
 */
export function isPointOnCountry (country, lat, lon) {
  const buffered = bufferedByCode.get(country.code)
  if (!buffered) return false
  return geoContains(buffered, [lon, lat])
}
