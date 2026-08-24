import * as THREE from 'three'
import { geoPath, geoEquirectangular } from 'd3-geo'
import { latLonToVector3, vector3ToLatLon } from './geo.js'
import { ALL_BOUNDARY_FEATURES } from './data/countryData.js'
import { buildShadowTexture } from './scene/shadow-texture.js'
import { createStarField } from './scene/starfield.js'
import { createClassroom } from './scene/classroom.js'
import { createHourglass, HOURGLASS_RADIUS, HOURGLASS_HALF_HEIGHT } from './scene/hourglass.js'
import { computeClearOfGlobePosition } from './scene/adaptive-position.js'
import WORLD_BASEMAP_URL from './textures/world-basemap.webp'

const GLOBE_RADIUS = 4
const TEXTURE_W = 4096
const TEXTURE_H = 2048

const DRAG_SENSITIVITY = 0.0045 // radians per pixel
const INERTIA_FRICTION = 0.94 // per 1/60s frame
const KEY_BASE_SPEED = 0.9 // rad/s
const KEY_MAX_SPEED = 4.2 // rad/s
const KEY_ACCEL = 3.2 // rad/s per second held
const MAX_PITCH = Math.PI / 2 - 0.05 // clamp so we don't flip over the poles awkwardly

const TABLE_TOP_Y = -(GLOBE_RADIUS + 1.4) // where the tabletop sits when fully "light"
const TABLE_HIDDEN_Y = TABLE_TOP_Y - 10 // parked below the scene when fully "dark"
const FLOOR_Y = TABLE_TOP_Y - 3 // a plausible gap below the tabletop, as if legs were there
const TABLE_HEIGHT = 1.4
const THEME_EASE = 0.997 // per-frame smoothing rate for the theme transition (see _tick)
const TILT_RETURN_EASE = 0.9993 // per-frame smoothing rate for easing pitch back to 0 (see _updateTiltReturn)
const TILT_RETURN_EPSILON = 0.0015 // rad; close enough to 0 that we just snap and stop

// The hourglass sits at the globe's own depth (0), so clearing it is just "outside the
// globe's actual radius" with no perspective growth to account for (see
// computeClearOfGlobePosition). It rests on the tabletop surface beside the globe, in
// both landscape and portrait; parked far below the scene when hidden, like the table itself.
const HOURGLASS_DEPTH = 0
const HOURGLASS_MARGIN = 0.5
const HOURGLASS_GROUND_Y = TABLE_TOP_Y + TABLE_HEIGHT / 2 + HOURGLASS_HALF_HEIGHT
const HOURGLASS_HIDDEN_POS = { x: 0, y: TABLE_HIDDEN_Y - 3, z: HOURGLASS_DEPTH }

// Base tint applied under the basemap texture.
const GLOBE_COLOR_DARK = new THREE.Color(0xcccccc)
const GLOBE_COLOR_LIGHT = new THREE.Color(0xffffff)

// Lighting for the globe only (everything else in the scene stays flat/self-lit — see
// the MeshBasicMaterials throughout). A single hemisphere light is a cheap way to say
// "many lights up top, a few down below": it shades any point on the sphere by how much
// its world-space normal faces up vs. down, independent of the globe's own spin, so the
// sphere reads as lit from directly above — consistent with the fake contact shadow
// sitting directly beneath it on the table, instead of looking flat while casting a shadow.
const GLOBE_LIGHT_SKY_COLOR = 0xffffff
const GLOBE_LIGHT_GROUND_COLOR = 0x808080
const GLOBE_LIGHT_INTENSITY = 4

/** Resolves an Image once loaded. */
function loadImage (path) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load "${path}"`))
    img.src = path
  })
}

// A Globe can be torn down/rebuilt many times in one session (e.g. leaving/re-entering the
// game screen). Caching the load promises at module scope means every Globe after the first
// gets the already-loaded image instantly instead of re-fetching it each time.
let _worldBasemapPromise = null
function getWorldBasemapImage () {
  if (!_worldBasemapPromise) _worldBasemapPromise = loadImage(WORLD_BASEMAP_URL)
  return _worldBasemapPromise
}

/**
 * Rasterizes every country's border outline (including unplayable/no-code territories) with
 * d3-geo, over the hand-painted basemap (which already carries the land/ocean/desert/ice
 * colors) that must already be drawn into ctx.
 */
function drawBoundaries (ctx, features) {
  const projection = geoEquirectangular()
    .translate([TEXTURE_W / 2, TEXTURE_H / 2])
    .scale(TEXTURE_W / (2 * Math.PI))

  const path = geoPath(projection, ctx)

  ctx.save()

  // Don't let boundary strokes paint directly onto the texture seam.
  ctx.beginPath()
  ctx.rect(1, 0, TEXTURE_W - 2, TEXTURE_H)
  ctx.clip()

  for (const feature of features) {
    ctx.beginPath()
    path(feature)
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.55)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  ctx.restore()
}

/** Paints the globe canvas: hand-painted basemap + border outlines. */
function paintGlobeCanvas (ctx, boundaryFeatures, baseImage) {
  ctx.clearRect(0, 0, TEXTURE_W, TEXTURE_H)
  ctx.drawImage(baseImage, 0, 0, TEXTURE_W, TEXTURE_H)
  drawBoundaries(ctx, boundaryFeatures)
}

export class Globe {
  constructor (container, countries, initialTheme = 'dark') {
    this.container = container
    this.countries = countries
    this.interactive = false
    this.autoRotateSpeed = 0 // rad/s
    this.markers = []

    // Theme transition state (env crossfade/translate + table/shadow float-in), eased in _tick.
    this.theme = initialTheme
    this._envMixTarget = initialTheme === 'light' ? 1 : 0 // 0 = dark (space), 1 = light (classroom)
    this._envMix = this._envMixTarget
    this._tableTargetY = initialTheme === 'light' ? TABLE_TOP_Y : TABLE_HIDDEN_Y
    this._shadowTargetScale = initialTheme === 'light' ? 1 : 0.001
    this._shadowTargetOpacity = initialTheme === 'light' ? 1 : 0

    // Eases back to 0 whenever gameplay ends, so the globe doesn't stay stuck at
    // whatever tilt the player last dragged it to (see setMode/_updateTiltReturn).
    this._returningTilt = false

    this._buildScene()
    this._bindEvents()
    this._running = false
    this._lastT = performance.now()

    // drag state
    this.dragging = false
    this._lastPointer = null
    this._lastMoveT = 0
    this.velocity = { x: 0, y: 0 } // rad/s equivalent
    this.yaw = 0
    this.pitch = 0
    this._axisX = new THREE.Vector3(1, 0, 0)
    this._axisY = new THREE.Vector3(0, 1, 0)

    this._qYaw = new THREE.Quaternion()
    this._qPitch = new THREE.Quaternion()

    // keyboard state
    this._keys = {} // code -> holdStart timestamp
  }

  _buildScene () {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100)
    this._updateCameraDistance()

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(w, h)
    this.container.appendChild(this.renderer.domElement)
    this.canvasEl = this.renderer.domElement

    this.globeGroup = new THREE.Group()
    this.scene.add(this.globeGroup)

    // Lit (not MeshBasicMaterial like the rest of the scene) so it actually shades — see
    // GLOBE_LIGHT_* above.
    const geometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 48)
    const material = new THREE.MeshLambertMaterial({
      color: this.theme === 'dark' ? GLOBE_COLOR_DARK : GLOBE_COLOR_LIGHT
    })
    this.sphere = new THREE.Mesh(geometry, material)
    this.globeGroup.add(this.sphere)

    // Fixed in world space (not added to globeGroup), so the shading stays put — bright
    // near the top, darker near the bottom — regardless of how the player spins the globe.
    this.globeLight = new THREE.HemisphereLight(
      GLOBE_LIGHT_SKY_COLOR,
      GLOBE_LIGHT_GROUND_COLOR,
      GLOBE_LIGHT_INTENSITY
    )
    this.scene.add(this.globeLight)
    // Interpolated smoothly toward in _updateThemeTransition, same as the env crossfade/table.
    this._globeColorTarget = (this.theme === 'dark' ? GLOBE_COLOR_DARK : GLOBE_COLOR_LIGHT).clone()

    getWorldBasemapImage()
      .then((img) => {
        if (this._disposed) return
        const canvas = document.createElement('canvas')
        canvas.width = TEXTURE_W
        canvas.height = TEXTURE_H
        paintGlobeCanvas(canvas.getContext('2d'), ALL_BOUNDARY_FEATURES, img)

        const texture = new THREE.CanvasTexture(canvas)
        if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace
        texture.needsUpdate = true

        this.sphere.material.map = texture
        this.sphere.material.needsUpdate = true
      })

    // thin rim outline for a bit of depth
    const rimGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.01, 48, 32)
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x4fd8c4,
      transparent: true,
      opacity: 0.06,
      side: THREE.BackSide,
    })
    this.rim = new THREE.Mesh(rimGeo, rimMat)
    this.globeGroup.add(this.rim)

    this.markerGroup = new THREE.Group()
    this.globeGroup.add(this.markerGroup)

    // Dark theme: Earth floating in space. Light theme: the globe sitting on a teacher's
    // table in a classroom. Both are built up front and cross-faded/translated (see
    // _updateThemeTransition) instead of swapping assets, so the transition is smooth.
    this.starfield = createStarField({ getDarkOpacity: () => this._darkOpacity() })
    this.scene.add(this.starfield.group)
    this.classroom = createClassroom({ floorY: FLOOR_Y })
    this.scene.add(this.classroom.group)

    // The countdown hourglass: light-theme only (dark mode's countdown is the starfield's
    // comet). Positioned adaptively so it's never stuck behind the globe — see
    // _updateHourglassShownPosition and scene/adaptive-position.js.
    this.hourglass = createHourglass()
    this.scene.add(this.hourglass.group)
    this._updateHourglassShownPosition()
    this._hourglassTarget = this.theme === 'light' ? this._hourglassShownPos : HOURGLASS_HIDDEN_POS
    this.hourglass.group.position.set(this._hourglassTarget.x, this._hourglassTarget.y, this._hourglassTarget.z)

    // Classroom table: a simple cuboid the globe appears to float above (light theme only).
    // Wide enough that the hourglass (see _updateHourglassShownPosition) sits fully on it.
    const tableGeo = new THREE.BoxGeometry(12, TABLE_HEIGHT, 5)
    const tableMat = new THREE.MeshBasicMaterial({ color: 0x6b4a2c })
    this.table = new THREE.Mesh(tableGeo, tableMat)
    this.table.position.set(0, this._tableTargetY, 0)
    this.scene.add(this.table)

    // Fake contact shadow: a gradient plane on the tabletop, growing as the "globe
    // floats closer" (i.e. as the table rises into place during the transition).
    const shadowGeo = new THREE.PlaneGeometry(6, 6)
    const shadowMat = new THREE.MeshBasicMaterial({
      map: buildShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: this._shadowTargetOpacity,
    })
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.set(0, this._tableTargetY + 0.71, 0)
    this.shadow.scale.setScalar(Math.max(0.001, this._shadowTargetScale))
    this.scene.add(this.shadow)
  }

  _darkOpacity () { return 1 - this._envMix }

  
  /** Recomputes where the hourglass should sit when shown, based on the current camera
   * distance (see scene/adaptive-position.js). Call after any camera-distance change. */
  _updateHourglassShownPosition () {
    this._hourglassShownPos = computeClearOfGlobePosition({
      cameraZ: this.camera.position.z,
      globeRadius: GLOBE_RADIUS,
      depth: HOURGLASS_DEPTH,
      objectRadius: HOURGLASS_RADIUS,
      margin: HOURGLASS_MARGIN,
      groundY: HOURGLASS_GROUND_Y,
    })
    if (this.theme === 'light') this._hourglassTarget = this._hourglassShownPos
  }

  _updateCameraDistance () {
    const aspect = this.container.clientWidth / this.container.clientHeight
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov)

    // Fit the sphere vertically.
    let distance = GLOBE_RADIUS / Math.tan(verticalFov / 2)

    // On portrait screens, horizontal FOV becomes the limiting dimension.
    if (aspect < 1) {
      const horizontalFov = 2 * Math.atan(
        Math.tan(verticalFov / 2) * aspect
      )

      distance = GLOBE_RADIUS / Math.tan(horizontalFov / 2)
    }

    // Small margin so the rim never touches the viewport.
    this.camera.position.z = distance * 1.2
  }

  _bindEvents () {
    const el = this.canvasEl

    this._onPointerDown = (e) => {
      if (!this.interactive) return

      this.dragging = true
      this.velocity = { x: 0, y: 0 }
      this._lastPointer = { x: e.clientX, y: e.clientY }
      this._lastMoveT = performance.now()

      el.setPointerCapture?.(e.pointerId)
    }

    this._onPointerMove = (e) => {
      if (!this.interactive || !this.dragging || !this._lastPointer) return

      const now = performance.now()
      const dt = Math.max(1, now - this._lastMoveT) / 1000

      const dx = this._lastPointer.x - e.clientX
      const dy = this._lastPointer.y - e.clientY

      this._applyDragDelta(dx, dy)

      this.velocity.x = dx / dt
      this.velocity.y = dy / dt

      this._lastPointer = {
        x: e.clientX,
        y: e.clientY,
      }
      this._lastMoveT = now
    }

    this._onPointerUp = (e) => {
      if (!this.interactive) return

      this.dragging = false
      this._lastPointer = null

      if (el.hasPointerCapture?.(e.pointerId)) {
        el.releasePointerCapture(e.pointerId)
      }
    }

    el.addEventListener('pointerdown', this._onPointerDown)
    el.addEventListener('pointermove', this._onPointerMove)
    el.addEventListener('pointerup', this._onPointerUp)
    el.addEventListener('pointercancel', this._onPointerUp)

    this._onKeyDown = (e) => {
      if (!this.interactive) return
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
      e.preventDefault()
      if (!(e.key in this._keys)) this._keys[e.key] = performance.now()
    }
    this._onKeyUp = (e) => {
      delete this._keys[e.key]
    }
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)

    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)
  }

  _applyDragDelta (dx, dy) {
    const angleY = -dx * DRAG_SENSITIVITY
    const angleX = -dy * DRAG_SENSITIVITY
    this._rotateWorld(angleY, angleX)
  }

  _rotateWorld (angleY, angleX) {
    this.yaw += angleY
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + angleX,
      -MAX_PITCH,
      MAX_PITCH
    )

    this._qYaw.setFromAxisAngle(this._axisY, this.yaw)
    this._qPitch.setFromAxisAngle(this._axisX, this.pitch)

    this.globeGroup.quaternion
      .copy(this._qPitch)
      .multiply(this._qYaw)
  }

  setMode ({ interactive, autoRotateRpm = 0 }) {
    // Leaving interactive (gameplay) mode: ease the tilt the player left the globe at
    // back to its default. Re-entering interactive mode cancels any return in progress.
    if (this.interactive && !interactive) this._returningTilt = true
    else if (interactive) this._returningTilt = false

    this.interactive = interactive
    this.autoRotateSpeed = (autoRotateRpm * 2 * Math.PI) / 60 // rpm -> rad/s
    this.dragging = false
    this.velocity = { x: 0, y: 0 }
    this._keys = {}
  }

  /** Updates the countdown visuals (comet in dark mode, hourglass in light mode).
   * @param {number} remainingFraction - 1 = full time left, 0 = out of time. */
  setCountdownProgress (remainingFraction) {
    this.starfield.setCountdownProgress(remainingFraction)
    this.hourglass.setCountdownProgress(remainingFraction)
  }

  /** Smoothly transitions the scene between the 'dark' (space) and 'light' (classroom) themes. */
  setTheme (theme) {
    if (theme === this.theme) return
    this.theme = theme
    this._envMixTarget = theme === 'light' ? 1 : 0
    if (theme === 'light') {
      this._tableTargetY = TABLE_TOP_Y
      this._shadowTargetScale = 1
      this._shadowTargetOpacity = 1
      this._hourglassTarget = this._hourglassShownPos
    } else {
      this._tableTargetY = TABLE_HIDDEN_Y
      this._shadowTargetScale = 0.001
      this._shadowTargetOpacity = 0
      this._hourglassTarget = HOURGLASS_HIDDEN_POS
    }
    this._globeColorTarget = (theme === 'dark' ? GLOBE_COLOR_DARK : GLOBE_COLOR_LIGHT).clone()
  }

  resize () {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this._updateCameraDistance()
    this._updateHourglassShownPosition()
    this.renderer.setSize(w, h)
  }

  /** Returns the lat/lon of the point on the globe currently facing the camera. */
  getFacingLatLon () {
    const worldFacing = this.camera.position.clone().normalize().multiplyScalar(GLOBE_RADIUS)
    const invQ = this.globeGroup.quaternion.clone().invert()
    const localFacing = worldFacing.applyQuaternion(invQ)
    return vector3ToLatLon(localFacing, GLOBE_RADIUS)
  }

  /** Adds a temporary glowing marker at lat/lon that fades out and removes itself. */
  addFoundMarker (lat, lon, color = 0x4ade80) {
    const pos = latLonToVector3(lat, lon, GLOBE_RADIUS * 1.02)
    const geo = new THREE.SphereGeometry(0.12, 16, 16)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(pos.x, pos.y, pos.z)
    this.markerGroup.add(mesh)
    this.markers.push({ mesh, born: performance.now(), life: 1600 })
  }

  _updateMarkers (now) {
    this.markers = this.markers.filter((m) => {
      const age = now - m.born
      const p = Math.min(1, age / m.life)
      m.mesh.material.opacity = 1 - p
      m.mesh.scale.setScalar(1 + p * 2.2)
      if (p >= 1) {
        this.markerGroup.remove(m.mesh)
        m.mesh.geometry.dispose()
        m.mesh.material.dispose()
        return false
      }
      return true
    })
  }

  _updateKeyboard (dt, now) {
    let angY = 0
    let angX = 0
    const compute = (key) => {
      const start = this._keys[key]
      if (start == null) return 0
      const held = (now - start) / 1000
      return Math.min(KEY_MAX_SPEED, KEY_BASE_SPEED + held * KEY_ACCEL) * dt
    }
    angY += compute('ArrowLeft') * -1
    angY += compute('ArrowRight')
    angX += compute('ArrowUp') * -1
    angX += compute('ArrowDown')
    if (angY !== 0 || angX !== 0) this._rotateWorld(angY, angX)
  }

  _updateInertia (dt) {
    if (this.dragging) return
    if (Math.abs(this.velocity.x) < 0.5 && Math.abs(this.velocity.y) < 0.5) return
    this._applyDragDelta(this.velocity.x * dt, this.velocity.y * dt)
    const decay = Math.pow(INERTIA_FRICTION, dt * 60)
    this.velocity.x *= decay
    this.velocity.y *= decay
  }

  /** Eases the space/classroom crossfade (+ classroom translate), table height, shadow,
   * and globe color toward their targets. */
  _updateThemeTransition (dt) {
    const ease = 1 - Math.pow(THEME_EASE, dt * 1000)

    this._envMix += (this._envMixTarget - this._envMix) * ease
    this.starfield.group.visible = this._envMix < 0.995
    this.classroom.group.visible = this._envMix > 0.005
    // Purely a function of _envMix (not a one-shot animation), so scrubbing the theme
    // back and forth mid-transition reverts the wall/floor translation exactly.
    this.classroom.setThemeMix(this._envMix)

    this.table.position.y += (this._tableTargetY - this.table.position.y) * ease
    this.shadow.position.y = this.table.position.y + 0.71

    const nextScale = this.shadow.scale.x + (this._shadowTargetScale - this.shadow.scale.x) * ease
    this.shadow.scale.setScalar(Math.max(0.001, nextScale))
    this.shadow.material.opacity += (this._shadowTargetOpacity - this.shadow.material.opacity) * ease

    const hgPos = this.hourglass.group.position
    const hgTarget = this._hourglassTarget
    hgPos.x += (hgTarget.x - hgPos.x) * ease
    hgPos.y += (hgTarget.y - hgPos.y) * ease
    hgPos.z += (hgTarget.z - hgPos.z) * ease

    this.sphere.material.color.lerp(this._globeColorTarget, ease)
  }

  /** Eases pitch back to 0 after leaving interactive mode (see setMode). Reuses
   * _rotateWorld so the quaternion stays in sync with yaw/autoRotate as usual. */
  _updateTiltReturn (dt) {
    if (Math.abs(this.pitch) < TILT_RETURN_EPSILON) {
      if (this.pitch !== 0) this._rotateWorld(0, -this.pitch)
      this._returningTilt = false
      return
    }
    const ease = 1 - Math.pow(TILT_RETURN_EASE, dt * 1000)
    this._rotateWorld(0, -this.pitch * ease)
  }

  _tick = () => {
    if (!this._running) return
    const now = performance.now()
    const dt = Math.min(0.05, (now - this._lastT) / 1000)
    this._lastT = now

    if (this.autoRotateSpeed !== 0) {
      this._rotateWorld(this.autoRotateSpeed * dt, 0)
    }
    if (this.interactive) {
      this._updateKeyboard(dt, now)
      this._updateInertia(dt)
    } else if (this._returningTilt) {
      this._updateTiltReturn(dt)
    }
    this._updateMarkers(now)
    this._updateThemeTransition(dt)
    this.starfield.update(now)

    this.renderer.render(this.scene, this.camera)
    this._raf = window.requestAnimationFrame(this._tick)
  }

  start () {
    if (this._running) return
    this._running = true
    this._lastT = performance.now()
    this._raf = window.requestAnimationFrame(this._tick)
  }

  stop () {
    this._running = false
    if (this._raf) window.cancelAnimationFrame(this._raf)
  }

  dispose () {
    this.stop()
    this._disposed = true
    const el = this.canvasEl
    el.removeEventListener('pointerdown', this._onPointerDown)
    el.removeEventListener('pointermove', this._onPointerMove)
    el.removeEventListener('pointerup', this._onPointerUp)
    el.removeEventListener('pointercancel', this._onPointerUp)
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('resize', this._onResize)

    this.sphere.geometry.dispose()
    this.sphere.material.map?.dispose()
    this.sphere.material.dispose()
    this.scene.remove(this.globeLight)
    this.rim.geometry.dispose()
    this.rim.material.dispose()
    for (const m of this.markers) {
      m.mesh.geometry.dispose()
      m.mesh.material.dispose()
    }
    this.markers = []

    this.starfield.dispose()
    this.classroom.dispose()
    this.hourglass.dispose()
    this.table.geometry.dispose()
    this.table.material.dispose()
    this.shadow.geometry.dispose()
    this.shadow.material.map?.dispose()
    this.shadow.material.dispose()
    this.renderer.dispose()
    this.canvasEl.remove()
  }
}
