/**
 * Generates a random 32-bit seed using the platform CSPRNG when available.
 * The seed is logged as an audit event so a game's country sequence can be
 * independently recomputed and compared against what was reported.
 */
export function generateSeed () {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1)
    crypto.getRandomValues(arr)
    return arr[0] >>> 0
  }
  return (Math.random() * 0xffffffff) >>> 0
}

/** mulberry32 — small, fast, deterministic PRNG seeded by a 32-bit integer. */
export function mulberry32 (seed) {
  let a = seed >>> 0
  return function next () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pick a uniformly random element from an array using a seeded rng() function. */
export function pickRandom (rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}
