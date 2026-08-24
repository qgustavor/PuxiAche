import * as THREE from 'three'

const STAR_COUNT = 900
const STAR_FIELD_RADIUS = 45
const STAR_ACCENT_COLORS = [0x2fd6c0, 0xf5a623, 0xffffff] // a few tinted "low-poly" stars for accent
// Stays behind the classroom wall (z=-16 in classroom.js), with margin. The starfield
// itself is always fully opaque — the wall physically slides away to reveal it (see
// classroom.js's setThemeMix), like opening a hatch, rather than the stars fading in.
const STAR_NEAR_Z = -20

// The countdown comet sweeps left -> right near the top of the scene as the round's time
// elapses, low enough to stay clear of the globe (whose top sits around y=4). Unlike the
// static star field, it stays in FRONT of the wall (shallower than STAR_NEAR_Z) and fades
// via getDarkOpacity instead of being occluded by it: at the comet's height, a depth deep
// enough to hide behind the wall would also put it inside the globe's own occlusion.
//
// COMET_Y_BASE is the comet's height at the START and END of its sweep (the arc only adds
// height at the midpoint, via sin(), which is 0 at both ends) — so it's the base value,
// not the arc's peak, that has to clear the globe's occlusion silhouette. In landscape
// (the tightest case, since the globe fills the screen's height there) that silhouette
// projects to about 7.2 at this depth, so a base of 7.4 left almost no margin: the comet
// only read as visible near the peak of its arc, i.e. only mid-flight.
const COMET_X_RANGE = [-17, 17]
const COMET_Y_BASE = 7.8
const COMET_Y_ARC = 0.5 // a gentle bulge over the course of the sweep, not a flat line
const COMET_Z = -10
const COMET_HEAD_RADIUS = 0.3
const COMET_TAIL_LENGTH = 1.7
const COMET_COOL_COLOR = new THREE.Color(0x9fd8ff)
const COMET_FIRE_COLOR = new THREE.Color(0xff7a33)
const FIRE_START_FRACTION = 0.18 // remaining-time fraction below which the comet "catches fire"

/** Standard smoothstep, 0..1, without relying on a specific three.js version having it. */
function smoothstep (x, edge0, edge1) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** A single low-poly comet: an icosahedron head + a cone tail trailing behind it. */
function buildComet () {
  const group = new THREE.Group()

  const headMat = new THREE.MeshBasicMaterial({ color: COMET_COOL_COLOR, transparent: true, opacity: 0 })
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(COMET_HEAD_RADIUS, 0), headMat)
  group.add(head)

  const tailGeo = new THREE.ConeGeometry(COMET_HEAD_RADIUS * 0.75, COMET_TAIL_LENGTH, 5, 1, true)
  tailGeo.rotateZ(-Math.PI / 2) // apex -> +X (leading edge, touches the head); base trails toward -X
  const tailMat = new THREE.MeshBasicMaterial({
    color: COMET_COOL_COLOR,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const tail = new THREE.Mesh(tailGeo, tailMat)
  tail.position.x = -COMET_TAIL_LENGTH / 2
  group.add(tail)

  return { group, head, tail, headMat, tailMat }
}

/**
 * @param {object} opts
 * @param {() => number} opts.getDarkOpacity - 0..1, how "in dark mode" the scene currently
 * is. Only the comet uses this (its own animated fade); the static star points/accents are
 * always fully opaque and rely on the wall physically occluding them — see STAR_NEAR_Z.
 */
export function createStarField ({ getDarkOpacity }) {
  const group = new THREE.Group()

  const positions = new Float32Array(STAR_COUNT * 3)
  for (let i = 0; i < STAR_COUNT; i++) {
    // Spread across a big shell so stars stay visible regardless of aspect ratio, but bias
    // away from the very center so they don't clip through the globe.
    const r = STAR_FIELD_RADIUS * (0.35 + Math.random() * 0.65)
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = -Math.abs(r * Math.cos(phi)) + STAR_NEAR_Z
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.09,
    sizeAttenuation: true,
    depthWrite: false,
  })
  group.add(new THREE.Points(starGeo, starMat))

  // A few tiny low-poly polyhedra scattered around as "accent" stars/asteroids.
  for (let i = 0; i < 14; i++) {
    const size = 0.12 + Math.random() * 0.22
    const geo = new THREE.IcosahedronGeometry(size, 0)
    const color = STAR_ACCENT_COLORS[Math.floor(Math.random() * STAR_ACCENT_COLORS.length)]
    const mat = new THREE.MeshBasicMaterial({ color })
    const mesh = new THREE.Mesh(geo, mat)
    const r = STAR_FIELD_RADIUS * (0.3 + Math.random() * 0.5)
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    mesh.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      -Math.abs(r * Math.cos(phi)) + STAR_NEAR_Z
    )
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    group.add(mesh)
  }

  const comet = buildComet()
  group.add(comet.group)

  let remainingFraction = 1 // 1 = full time left, 0 = out of time

  function setCountdownProgress (fraction) {
    remainingFraction = THREE.MathUtils.clamp(fraction, 0, 1)
  }

  /** Advances the comet's flicker and repositions it; call once per rendered frame. */
  function update (now) {
    const darkOpacity = getDarkOpacity()

    const elapsed = 1 - remainingFraction
    const x = THREE.MathUtils.lerp(COMET_X_RANGE[0], COMET_X_RANGE[1], elapsed)
    const y = COMET_Y_BASE + Math.sin(elapsed * Math.PI) * COMET_Y_ARC
    comet.group.position.set(x, y, COMET_Z)

    // Only visible mid-flight (not parked at the very start/end) and only in dark mode.
    const flightVisibility = smoothstep(elapsed, 0.02, 0.08) * (1 - smoothstep(elapsed, 0.94, 0.99))
    const baseOpacity = darkOpacity * flightVisibility

    const burn = 1 - smoothstep(remainingFraction, 0, FIRE_START_FRACTION)
    const flicker = burn > 0 ? 1 + Math.sin(now * 0.02) * 0.12 * burn : 1

    comet.headMat.color.lerpColors(COMET_COOL_COLOR, COMET_FIRE_COLOR, burn)
    comet.tailMat.color.lerpColors(COMET_COOL_COLOR, COMET_FIRE_COLOR, burn)
    comet.headMat.opacity = Math.min(1, baseOpacity * flicker)
    comet.tailMat.opacity = Math.min(1, baseOpacity * (0.55 + burn * 0.3) * flicker)
    comet.tail.scale.x = 1 + burn * 0.9 // the tail lengthens as it catches fire

    // Shrinking alongside the opacity fade (not just fading) hides the hollow open-ended
    // tail cone's inside faces — at partial opacity alone they'd read as visible seams.
    comet.group.scale.setScalar(Math.max(0.001, flightVisibility))
  }

  function dispose () {
    starGeo.dispose()
    starMat.dispose()
    for (const child of group.children) {
      child.geometry?.dispose()
      child.material?.dispose()
    }
  }

  return { group, setCountdownProgress, update, dispose }
}
