/**
 * Positions an object resting on a ground plane beside the globe, offset sideways just far
 * enough to clear the globe's occlusion silhouette. Works in both landscape and portrait:
 * the margin around the globe in whichever dimension the camera fits it to (see globe.js's
 * _updateCameraDistance) is always the same fixed multiple of the globe's radius, regardless
 * of aspect ratio — so for a groundY close to the globe's own center, the sideways offset
 * needed to clear it comfortably fits within that margin either way.
 *
 * @param {object} opts
 * @param {number} opts.cameraZ - camera.position.z (the camera looks toward the origin along -Z).
 * @param {number} opts.globeRadius
 * @param {number} opts.depth - world Z the object sits at (0 = same depth as the globe's center).
 * @param {number} opts.objectRadius - approximate on-screen radius of the object itself.
 * @param {number} [opts.margin=0.5] - extra clearance beyond the globe's silhouette.
 * @param {number} [opts.groundY=0] - world Y of the surface to rest on (e.g. a tabletop).
 * @returns {{x: number, y: number, z: number}}
 */
export function computeClearOfGlobePosition ({
  cameraZ, globeRadius, depth, objectRadius, margin = 0.5, groundY = 0,
}) {
  const distanceToObject = cameraZ - depth
  // The globe's occlusion silhouette scales with distance behind it (similar triangles),
  // so a fixed clearance isn't enough on its own — it has to account for depth too. At
  // depth 0 (the globe's own depth) this reduces to exactly globeRadius, as expected.
  const silhouetteRadius = globeRadius * (distanceToObject / cameraZ)
  const requiredRadius = silhouetteRadius + objectRadius + margin

  // Offset sideways just far enough that the distance from the globe's center — accounting
  // for both axes — still clears requiredRadius.
  const x = Math.sqrt(Math.max(0, requiredRadius * requiredRadius - groundY * groundY))
  return { x, y: groundY, z: depth }
}
