import * as THREE from 'three'

/** Soft radial-gradient blob used as a fake contact shadow under the floating globe. */
export function buildShadowTexture () {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)')
  grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.22)')
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}
