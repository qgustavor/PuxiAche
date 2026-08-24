import * as THREE from 'three'

const FRAME_COLOR = 0x8a5a34
const GLASS_COLOR = 0xdff6ff
const SAND_COOL_COLOR = new THREE.Color(0xe0b96a)
const SAND_WARM_COLOR = new THREE.Color(0xff7a33)
const LOW_TIME_FRACTION = 0.18 // remaining-time fraction below which the sand glows warm

const BULB_RADIUS = 0.55
const BULB_HEIGHT = 0.75
const DISK_RADIUS = 0.85
const DISK_THICKNESS = 0.14
const POST_RADIUS = 0.05
const PINCH_GAP = 0.08 // vertical gap between the two bulbs, where the sand falls through

/** Approximate on-screen radius, for adaptive-position.js's clearance calculation. */
export const HOURGLASS_RADIUS = DISK_RADIUS
/** Approximate half-height, for placing it resting on a surface (see adaptive-position.js). */
export const HOURGLASS_HALF_HEIGHT = BULB_HEIGHT + PINCH_GAP + DISK_THICKNESS / 2

function buildFrame () {
  const diskGeo = new THREE.CylinderGeometry(DISK_RADIUS, DISK_RADIUS, DISK_THICKNESS, 8)
  const diskMat = new THREE.MeshBasicMaterial({ color: FRAME_COLOR })
  const topDisk = new THREE.Mesh(diskGeo, diskMat)
  topDisk.position.y = BULB_HEIGHT + PINCH_GAP
  const bottomDisk = new THREE.Mesh(diskGeo, diskMat)
  bottomDisk.position.y = -(BULB_HEIGHT + PINCH_GAP)

  const postHeight = (BULB_HEIGHT + PINCH_GAP) * 2
  const postGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, postHeight, 6)
  const posts = []
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2
    const post = new THREE.Mesh(postGeo, diskMat)
    post.position.set(Math.cos(angle) * DISK_RADIUS * 0.82, 0, Math.sin(angle) * DISK_RADIUS * 0.82)
    posts.push(post)
  }

  return { meshes: [topDisk, bottomDisk, ...posts], geometries: [diskGeo, postGeo], materials: [diskMat] }
}

function buildGlass () {
  const geo = new THREE.ConeGeometry(BULB_RADIUS, BULB_HEIGHT, 6, 1, true)
  const mat = new THREE.MeshBasicMaterial({
    color: GLASS_COLOR, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
  })
  // A cone's apex points +Y by default. The top bulb needs its narrow end pointing DOWN
  // toward the pinch, so it's flipped; the bottom bulb's narrow end already points up.
  const top = new THREE.Mesh(geo, mat)
  top.rotation.z = Math.PI
  top.position.y = PINCH_GAP / 2 + BULB_HEIGHT / 2
  const bottom = new THREE.Mesh(geo, mat)
  bottom.position.y = -(PINCH_GAP / 2 + BULB_HEIGHT / 2)

  return { meshes: [top, bottom], geometries: [geo], materials: [mat] }
}

/**
 * A cone whose local origin sits at one end rather than its center (three.js's default),
 * so scaling around the origin grows/shrinks it from that anchored end. Used for the sand
 * piles, which need to stay pinned to the pinch point (draining) or the bottom disk
 * (accumulating) as they resize — scaling a centered cone shrinks it toward its own middle,
 * which is what made the sand look like it was floating instead of draining/piling.
 */
function buildAnchoredCone (radius, height, radialSegments, anchor) {
  const geo = new THREE.ConeGeometry(radius, height, radialSegments)
  if (anchor === 'apex') {
    geo.translate(0, -height / 2, 0) // apex -> origin
    geo.rotateZ(Math.PI) // flip so the (wide) base ends up above the origin, not below
  } else { // anchor === 'base'
    geo.translate(0, height / 2, 0) // base -> origin, apex ends up above it
  }
  return geo
}

/** Sand piles, built slightly smaller than the glass so they read as contents, not walls. */
function buildSand () {
  const sandRadius = BULB_RADIUS * 0.82
  const sandHeight = BULB_HEIGHT * 0.9
  const sandMat = new THREE.MeshBasicMaterial({ color: SAND_COOL_COLOR, transparent: true, opacity: 0.95 })

  // Anchored at the apex, which sits at the pinch point — so as it scales down it visibly
  // drains toward the pinch, matching the top glass bulb's funnel shape.
  const topGeo = buildAnchoredCone(sandRadius, sandHeight, 6, 'apex')
  const topSand = new THREE.Mesh(topGeo, sandMat)
  topSand.position.y = PINCH_GAP / 2

  // Anchored at its base, which sits near the bottom disk — so as it scales up it visibly
  // piles up from the bottom, matching the bottom glass bulb's shape.
  const bottomGeo = buildAnchoredCone(sandRadius, sandHeight, 6, 'base')
  const bottomSand = new THREE.Mesh(bottomGeo, sandMat)
  bottomSand.position.y = -(PINCH_GAP / 2 + sandHeight)

  const streamGeo = new THREE.CylinderGeometry(0.025, 0.025, PINCH_GAP * 1.4, 5)
  const streamMat = new THREE.MeshBasicMaterial({ color: SAND_COOL_COLOR, transparent: true, opacity: 0 })
  const stream = new THREE.Mesh(streamGeo, streamMat)

  return {
    topSand,
    bottomSand,
    stream,
    meshes: [topSand, bottomSand, stream],
    geometries: [topGeo, bottomGeo, streamGeo],
    materials: [sandMat, streamMat],
  }
}

export function createHourglass () {
  const group = new THREE.Group()
  const disposables = { geometries: [], materials: [] }

  const frame = buildFrame()
  const glass = buildGlass()
  const sand = buildSand()
  for (const part of [frame, glass, sand]) {
    for (const mesh of part.meshes) group.add(mesh)
    disposables.geometries.push(...part.geometries)
    disposables.materials.push(...part.materials)
  }

  function setCountdownProgress (remainingFraction) {
    const remaining = THREE.MathUtils.clamp(remainingFraction, 0, 1)
    const elapsed = 1 - remaining

    sand.topSand.scale.setScalar(remaining)
    sand.bottomSand.scale.setScalar(elapsed)

    const flowing = remaining > 0.01 && remaining < 0.99
    sand.stream.material.opacity = flowing ? 0.9 : 0

    const warm = 1 - THREE.MathUtils.clamp(remaining / LOW_TIME_FRACTION, 0, 1)
    sand.topSand.material.color.lerpColors(SAND_COOL_COLOR, SAND_WARM_COLOR, warm)
  }

  function dispose () {
    for (const geo of disposables.geometries) geo.dispose()
    for (const mat of disposables.materials) mat.dispose()
  }

  return { group, setCountdownProgress, dispose }
}
