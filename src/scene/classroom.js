import * as THREE from 'three'

const WALL_COLOR = 0xe4d9c4
const FLOOR_COLOR = 0xc9b892
const BOARD_FRAME_COLOR = 0x6b4a2c
const CHALK_COLORS = [0xffffff, 0xf5e27a, 0xf2a7c3]

// Large enough to read as a real classroom blackboard and leave room for future doodles.
const BOARD_W = 32
const BOARD_H = 12
const FRAME_T = 0.28

const BLACKBOARD_URL = '/textures/blackboard.webp'
const BLACKBOARD_BASE_COLOR = 0x1f4d3a // shown before the image loads / if it's missing

// How far the wall/floor travel to fully hide themselves when transitioning to the
// starfield. This is a translation (not a fade), and it's purely a function of the
// dark/light mix each frame, so scrubbing the mix back and forth reverts it exactly.
const WALL_HIDE_TRAVEL = 36 // wall slides UP, off the top of the scene
const FLOOR_HIDE_TRAVEL = -26 // floor slides DOWN, off the bottom

function loadImage (path) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load "${path}"`))
    img.src = path
  })
}

// A Globe (and its classroom) can be torn down/rebuilt many times in one session (e.g.
// leaving/re-entering the game screen). Caching the load promise at module scope means
// every classroom after the first gets the already-loaded image instantly.
let _blackboardPromise = null
function getBlackboardImage () {
  if (!_blackboardPromise) _blackboardPromise = loadImage(BLACKBOARD_URL)
  return _blackboardPromise
}

/**
 * @param {object} opts
 * @param {number} opts.floorY - world Y for the floor plane (matches globe.js's table/floor layout).
 */
export function createClassroom ({ floorY }) {
  const group = new THREE.Group()
  // Everything mounted "on" the wall (board, frame, chalk tray, chalk, eraser) travels
  // with it as one rigid backdrop.
  const wallGroup = new THREE.Group()
  const floorGroup = new THREE.Group()
  group.add(wallGroup, floorGroup)

  const disposables = []
  const addMesh = (parent, geo, color, x, y, z, opts = {}) => {
    const mat = new THREE.MeshBasicMaterial({ color })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    if (opts.rotation) mesh.rotation.set(...opts.rotation)
    parent.add(mesh)
    disposables.push(mesh)
    return mesh
  }

  // Back wall + floor, big enough to cover the viewport in both landscape and portrait.
  addMesh(wallGroup, new THREE.PlaneGeometry(70, 40), WALL_COLOR, 0, 4, -16)
  addMesh(floorGroup, new THREE.PlaneGeometry(70, 60), FLOOR_COLOR, 0, floorY, -8, { rotation: [-Math.PI / 2, 0, 0] })

  // Blackboard + wooden frame, mounted on the back wall above/behind the table. The board
  // surface is a hand-drawn image asset (see BLACKBOARD_URL).
  const board = addMesh(wallGroup, new THREE.PlaneGeometry(BOARD_W, BOARD_H), BLACKBOARD_BASE_COLOR, 0, 3, -15.9)
  getBlackboardImage()
    .then((img) => {
      const tex = new THREE.Texture(img)
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
      tex.needsUpdate = true
      board.material.map = tex
      board.material.needsUpdate = true
    })
    .catch(() => { /* fine to just keep the flat base color if the asset isn't there yet */ })

  const frameT = FRAME_T
  addMesh(wallGroup, new THREE.BoxGeometry(BOARD_W + frameT * 2, frameT, 0.3), BOARD_FRAME_COLOR, 0, 3 + BOARD_H / 2 + frameT / 2, -15.8)
  addMesh(wallGroup, new THREE.BoxGeometry(BOARD_W + frameT * 2, frameT, 0.3), BOARD_FRAME_COLOR, 0, 3 - BOARD_H / 2 - frameT / 2, -15.8)
  addMesh(wallGroup, new THREE.BoxGeometry(frameT, BOARD_H, 0.3), BOARD_FRAME_COLOR, -BOARD_W / 2 - frameT / 2, 3, -15.8)
  addMesh(wallGroup, new THREE.BoxGeometry(frameT, BOARD_H, 0.3), BOARD_FRAME_COLOR, BOARD_W / 2 + frameT / 2, 3, -15.8)

  // Chalk tray with a few sticks of chalk and an eraser.
  addMesh(wallGroup, new THREE.BoxGeometry(BOARD_W * 0.9, 0.2, 0.4), BOARD_FRAME_COLOR, -0.4, 3 - BOARD_H / 2 - frameT - 0.1, -15.6)
  CHALK_COLORS.forEach((color, i) => {
    const chalk = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8)
    addMesh(wallGroup, chalk, color, BOARD_W * 0.45 - 2.9 + i * -0.5, 3 - BOARD_H / 2 - frameT + 0.02, -15.55, { rotation: [0, 0, Math.PI / 2] })
  })
  addMesh(wallGroup, new THREE.BoxGeometry(0.9, 0.28, 0.35), 0xdedad2, BOARD_W * 0.45 - 1.8, 3 - BOARD_H / 2 - frameT + 0.05, -15.55)

  /** envMix: 0 = fully dark/hidden, 1 = fully light/shown. Purely positional -> revertible. */
  function setThemeMix (envMix) {
    wallGroup.position.y = WALL_HIDE_TRAVEL * (1 - envMix)
    floorGroup.position.y = FLOOR_HIDE_TRAVEL * (1 - envMix)
  }

  function dispose () {
    for (const mesh of disposables) {
      mesh.geometry.dispose()
      mesh.material.map?.dispose()
      mesh.material.dispose()
    }
  }

  return { group, setThemeMix, dispose }
}
