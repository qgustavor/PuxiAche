const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI
const EARTH_RADIUS_KM = 6371

/**
 * Convert lat/lon (degrees) to a point on a sphere of the given radius.
 * This mapping is deliberately the SAME convention three.js's SphereGeometry
 * uses for its UVs, so a canvas texture drawn with matching (lon,lat) -> (px,py)
 * placement lines up with 3D marker positions computed here.
 */
export function latLonToVector3 (lat, lon, radius, target) {
  const phi = (90 - lat) * DEG2RAD // polar angle, 0 at north pole

  const x = radius * Math.sin(phi) * Math.cos(lon * DEG2RAD)
  const y = radius * Math.cos(phi)
  const z = -radius * Math.sin(phi) * Math.sin(lon * DEG2RAD)

  if (target) {
    target.set(x, y, z)
    return target
  }
  return { x, y, z }
}

/** Inverse of latLonToVector3: given a point on the sphere, return {lat, lon}. */
export function vector3ToLatLon (vec, radius) {
  const y = Math.max(-radius, Math.min(radius, vec.y))
  const phi = Math.acos(y / radius)
  const lat = 90 - phi * RAD2DEG
  const lon = Math.atan2(-vec.z, vec.x) * RAD2DEG
  return { lat, lon }
}

/** Equirectangular pixel position for a lat/lon, for drawing the blip texture. */
export function latLonToPixel (lat, lon, width, height) {
  const px = ((lon + 180) / 360) * width
  const py = ((90 - lat) / 180) * height
  return { x: px, y: py }
}

/** Great-circle distance in km between two lat/lon points. */
export function haversineKm (lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG2RAD
  const dLon = (lon2 - lon1) * DEG2RAD
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}
