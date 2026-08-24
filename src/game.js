import { COUNTRY_LIST, isPointOnCountry } from './data/countryData.js'
import { haversineKm } from './geo.js'
import { generateSeed, mulberry32, pickRandom } from './rng.js'
import { AuditTrail, generateGameId } from './audit.js'

export const GAME_DURATION_MS = 60000
export const SMALL_COUNTRY_AREA_KM2 = 30000
// Points scale continuously with a country's area — smaller country, more points — rather
// than a hard small/large cutoff (see pointsForCountry below). MIN/MAX are the point
// values for the largest and smallest countries in the dataset; everything else is
// interpolated between them on a log scale, then rounded to the nearest POINTS_STEP.
const MIN_POINTS = 100
const MAX_POINTS = 500
const POINTS_STEP = 10
const NEXT_MIN_KM = 600
const NEXT_MAX_KM = 4000
// A long-haul jump every so often, well beyond the usual max distance — otherwise the
// normal range rarely reaches across an ocean (e.g. Europe to the Americas), and a round
// can end up circling one landmass the whole time.
const LONG_JUMP_CHANCE = 0.2
const LONG_JUMP_MAX_KM = 20000 // roughly half of Earth's circumference: effectively "anywhere"
const FOUND_DWELL_MS = 200
const SKIP_COOLDOWN_MS = 350
const PLAYER_SEED_KEY = 'gd_playerSeed'
// After this many skips in a row, the next pick avoids small/hard-to-spot countries —
// doesn't affect auditing, since it's a pure function of in-session skip count, not of
// anything random or externally observed.
const SKIP_STREAK_AVOID_SMALL = 2
// Rounds over which the difficulty ramps up: round 1 (index 0) only offers countries at
// or above the dataset's first-quartile area; by round 7 (index 6) the area floor has
// linearly decayed to zero, so every country is in play. Kept short on purpose, since
// staying easy for long gets boring fast for skilled players.
const DIFFICULTY_RAMP_ROUNDS = 7

/** True if a country is worth bonus points for being small/hard to spot. */
export function isSpecialCountry (country) {
  return country.area < SMALL_COUNTRY_AREA_KM2
}

let _q1AreaCache = null
/** First-quartile country area (km²) across the whole playable list, memoized. */
function firstQuartileArea (list) {
  if (_q1AreaCache != null) return _q1AreaCache
  const areas = list.map((c) => c.area).slice().sort((a, b) => a - b)
  const idx = (areas.length - 1) * 0.25
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  _q1AreaCache = lo === hi ? areas[lo] : areas[lo] + (areas[hi] - areas[lo]) * (idx - lo)
  return _q1AreaCache
}

let _areaBoundsCache = null
function areaBounds (list) {
  if (_areaBoundsCache) return _areaBoundsCache
  const areas = list.map((c) => c.area)
  _areaBoundsCache = { min: Math.min(...areas), max: Math.max(...areas) }
  return _areaBoundsCache
}

/**
 * Points awarded for finding a country: MAX_POINTS for the smallest country in the
 * dataset down to MIN_POINTS for the largest, interpolated on a log scale (area spans
 * several orders of magnitude — a few km² up to Russia — so a linear scale would bunch
 * almost every country near one end). Continuous rather than a small/large binary split,
 * so two players who find the same *number* of countries can still land far apart on the
 * leaderboard depending on how many hard, tiny ones they actually nailed — that spread is
 * the whole point (a fixed 1-point/3-point split left most skilled players clustered on
 * roughly the same score).
 */
export function pointsForCountry (country) {
  const { min, max } = areaBounds(COUNTRY_LIST)
  if (min === max) return MAX_POINTS
  const clamped = Math.min(Math.max(country.area, min), max)
  const t = (Math.log(clamped) - Math.log(min)) / (Math.log(max) - Math.log(min))
  const raw = MAX_POINTS - t * (MAX_POINTS - MIN_POINTS)
  return Math.round(raw / POINTS_STEP) * POINTS_STEP
}

/**
 * Minimum country area allowed for the given (0-based) round index. Interpolates linearly
 * from the dataset's first quartile at round 1 down to zero (no restriction) at round
 * DIFFICULTY_RAMP_ROUNDS, and stays at zero afterwards — see DIFFICULTY_RAMP_ROUNDS above.
 */
function minAreaForRound (roundIndex) {
  const q1 = firstQuartileArea(COUNTRY_LIST)
  const t = Math.min(Math.max(roundIndex, 0), DIFFICULTY_RAMP_ROUNDS - 1) / (DIFFICULTY_RAMP_ROUNDS - 1)
  return q1 * (1 - t)
}

/** Reads (or creates and persists) this player's local seed. */
function getPlayerSeed () {
  try {
    const stored = localStorage.getItem(PLAYER_SEED_KEY)
    if (stored != null) {
      const parsed = Number(stored)
      if (Number.isFinite(parsed)) return parsed >>> 0
    }
  } catch (e) { /* ignore */ }

  const fresh = generateSeed()
  try {
    localStorage.setItem(PLAYER_SEED_KEY, String(fresh))
  } catch (e) { /* ignore */ }
  return fresh
}

/** Derives a per-game seed from the player seed and the current time. */
function deriveGameSeed (playerSeed, now) {
  const rng = mulberry32((playerSeed ^ (now >>> 0)) >>> 0)
  return (rng() * 0xffffffff) >>> 0
}

/**
 * True if `a` and `b`'s buffered territories are close enough to plausibly overlap.
 * Checked by testing each country's representative point against the other's buffer —
 * cheap (reuses the same geoContains check used for hit-testing) and, unlike a plain
 * centroid-distance minimum, it actually accounts for country size: a big country's
 * buffer can reach hundreds of km past its own centroid, which a fixed km threshold
 * between centroids doesn't see. This is what caused "chaining" (finding two countries
 * back to back with no movement): the previous min-distance check only compared
 * centroids, so a large country picked as "next" could already cover the point the
 * player was resting on.
 */
function buffersMayOverlap (a, b) {
  return isPointOnCountry(a, b.lat, b.lon) || isPointOnCountry(b, a.lat, a.lon)
}

/** Picks the next target country given the reference one, per the 600-4000km rule (with graceful fallbacks). */
function selectNext (rng, pool, usedCodes, refCountry, { avoidSmall, minArea = 0 } = {}) {
  let unused = pool.filter((c) => !usedCodes.has(c.code))
  if (unused.length === 0) {
    usedCodes.clear()
    unused = pool.slice()
  }

  const noOverlap = unused.filter((c) => !buffersMayOverlap(refCountry, c))
  const safe = noOverlap.length > 0 ? noOverlap : unused // fallback: better to risk a chain than get stuck

  const bySize = safe.filter((c) => c.area >= minArea && (!avoidSmall || !isSpecialCountry(c)))
  const candidatePool = bySize.length > 0 ? bySize : safe

  const { lat: refLat, lon: refLon } = refCountry
  const inRange = (min, max) =>
    candidatePool.filter((c) => {
      const d = haversineKm(refLat, refLon, c.lat, c.lon)
      return d >= min && d <= max
    })

  const maxKm = rng() < LONG_JUMP_CHANCE ? LONG_JUMP_MAX_KM : NEXT_MAX_KM
  let candidates = inRange(NEXT_MIN_KM, maxKm)
  if (candidates.length === 0) candidates = inRange(200, maxKm)
  if (candidates.length === 0) candidates = candidatePool // last resort: any safe, unused country

  return pickRandom(rng, candidates)
}

export class GameSession {
  /**
   * @param {object} opts
   * @param {(state: object) => void} opts.onRoundChange - called with { country, nextCountry, index }
   * @param {(result: object) => void} opts.onFound - called with { country, points, elapsedMs }
   * @param {(result: object) => void} opts.onSkip - called with { country, elapsedMs }
   * @param {(state: object) => void} opts.onTick - called periodically with { remainingMs, score }
   * @param {(summary: object) => void} opts.onEnd
   */
  constructor ({ onRoundChange, onFound, onSkip, onTick, onEnd } = {}) {
    this.onRoundChange = onRoundChange || (() => {})
    this.onFound = onFound || (() => {})
    this.onSkip = onSkip || (() => {})
    this.onTick = onTick || (() => {})
    this.onEnd = onEnd || (() => {})

    const now = Date.now()
    this.gameId = generateGameId()
    this.playerSeed = getPlayerSeed()
    this.seed = deriveGameSeed(this.playerSeed, now)
    this.rng = mulberry32(this.seed)
    // playerSeed + startedAt are enough to recompute this.seed later (see
    // deriveGameSeed), so the audit trail only needs to record those two, once — not a
    // redundant copy of the derived seed on every session.
    this.audit = new AuditTrail(this.gameId, now, this.playerSeed)

    this.score = 0
    this.foundCount = 0
    this.skippedCount = 0
    this.skipStreak = 0
    this.rounds = [] // { code, index, startedAt, resolvedAt, outcome, elapsedMs }
    this.usedCodes = new Set()
    this.currentCountry = null
    this.nextCountry = null // pre-selected "on deck" country shown in the preview slot
    this.roundIndex = -1
    this.roundStartT = 0
    this.startT = 0
    this.ended = false
  }

  start () {
    this.startT = performance.now()
    // Round 1 (index 0) draws only from countries at/above the first-quartile area, so
    // the player's very first round is a familiar, easy-to-spot country to warm up on,
    // rather than a tiny bonus-point island dropped on them with zero context. See
    // minAreaForRound.
    const minArea = minAreaForRound(0)
    const bigCountries = COUNTRY_LIST.filter((c) => c.area >= minArea)
    const first = pickRandom(this.rng, bigCountries.length > 0 ? bigCountries : COUNTRY_LIST)
    this._promote(first)
  }

  /**
   * Moves `country` into the current-round slot, logs the round, and immediately
   * pre-selects the next preview country relative to it. Pre-selecting eagerly (rather
   * than only when the round resolves) is what makes the "next" HUD slot possible: the
   * next country is always already decided by the time it needs to be shown, and moving
   * it into the main slot later doesn't change anything about how it was picked.
   */
  _promote (country) {
    this.usedCodes.add(country.code)
    this.currentCountry = country
    this.roundIndex += 1
    this.roundStartT = performance.now()
    this._dwellStart = null
    this.rounds.push({ code: country.code, index: this.roundIndex })
    this.audit.log('country_selected', { code: country.code, index: this.roundIndex })

    // Small countries get avoided entirely after a skip streak, to help the player
    // recover. Beyond that, difficulty ramps by area floor rather than an outright
    // small-country ban — see minAreaForRound.
    const avoidSmall = this.skipStreak >= SKIP_STREAK_AVOID_SMALL
    const minArea = minAreaForRound(this.roundIndex)
    this.nextCountry = selectNext(this.rng, COUNTRY_LIST, this.usedCodes, country, { avoidSmall, minArea })

    this.onRoundChange({ country: this.currentCountry, nextCountry: this.nextCountry, index: this.roundIndex })
  }

  /** Call frequently (e.g. every animation frame or ~120ms) with the globe's current facing lat/lon. */
  tick (facingLatLon) {
    if (this.ended) return
    const now = performance.now()
    const remainingMs = Math.max(0, GAME_DURATION_MS - (now - this.startT))
    this.onTick({ remainingMs, score: this.score })

    if (remainingMs <= 0) {
      this.end()
      return
    }

    if (this.currentCountry && facingLatLon) {
      if (isPointOnCountry(this.currentCountry, facingLatLon.lat, facingLatLon.lon)) {
        if (this._dwellStart == null) this._dwellStart = now
        if (now - this._dwellStart >= FOUND_DWELL_MS) {
          const dist = haversineKm(
            facingLatLon.lat,
            facingLatLon.lon,
            this.currentCountry.lat,
            this.currentCountry.lon
          )
          this._resolveFound(dist)
        }
      } else {
        this._dwellStart = null
      }
    }
  }

  _resolveFound (distanceKm) {
    const country = this.currentCountry
    const elapsedMs = performance.now() - this.roundStartT
    const points = pointsForCountry(country)
    this.score += points
    this.foundCount += 1
    this.skipStreak = 0

    const round = this.rounds[this.rounds.length - 1]
    round.outcome = 'found'
    round.elapsedMs = elapsedMs
    round.points = points

    this.audit.log('country_found', {
      code: country.code,
      index: this.roundIndex,
      elapsedMs,
      distanceKm,
      points,
    })

    this.onFound({ country, points, elapsedMs, distanceKm, score: this.score })
    this._promote(this.nextCountry)
  }

  skip () {
    if (this.ended || !this.currentCountry) return
    // Ignore skips that come in faster than a human plausibly intends to — otherwise
    // mashing the skip key/button lets a player farm points off pre-placed "next"
    // countries the instant the reticle happens to already sit on one.
    const now = performance.now()
    if (this._lastSkipT != null && now - this._lastSkipT < SKIP_COOLDOWN_MS) return
    this._lastSkipT = now

    const country = this.currentCountry
    const elapsedMs = performance.now() - this.roundStartT
    this.skippedCount += 1
    this.skipStreak += 1

    const round = this.rounds[this.rounds.length - 1]
    round.outcome = 'skipped'
    round.elapsedMs = elapsedMs
    round.points = 0

    this.audit.log('country_skipped', { code: country.code, index: this.roundIndex, elapsedMs })
    this.onSkip({ country, elapsedMs })
    this._promote(this.nextCountry)
  }

  end () {
    if (this.ended) return
    this.ended = true
    const durationMs = performance.now() - this.startT
    const summary = {
      gameId: this.gameId,
      seed: this.seed,
      score: this.score,
      foundCount: this.foundCount,
      skippedCount: this.skippedCount,
      durationMs,
      rounds: this.rounds,
    }
    this.audit.log('game_end', {
      score: this.score,
      foundCount: this.foundCount,
      skippedCount: this.skippedCount,
      durationMs,
    })
    // Fire-and-forget: the whole trail is compressed and sent as one write here, instead
    // of one network write per event during play (see AuditTrail.flush). Never block
    // ending the game — or the results screen — on this.
    this.audit.flush()
    this.onEnd(summary)
  }
}
