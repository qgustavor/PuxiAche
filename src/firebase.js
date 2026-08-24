// PuxiAche talks to the Realtime Database over its plain HTTPS REST API rather than the
// Firebase JS SDK. The game only ever does two unauthenticated operations — append a
// leaderboard entry, fetch a snapshot of the top scores — and never needs the SDK's realtime
// listeners or auth integration, so a handful of fetch() calls cover it for a fraction of
// the bundle weight.

// Local development always talks to the Firebase Local Emulator Suite (see firebase.json)
// instead of a real project, so no .env setup is needed to work on the game. The emulator's
// REST endpoint is identified by a namespace query param rather than by subdomain.
const EMULATOR_BASE_URL = 'http://localhost:9000'
const EMULATOR_NAMESPACE = 'demo-puxiache-default-rtdb'

let baseUrl = null
let namespace = null // only set for the emulator; a real databaseURL doesn't need it

/**
 * Resolves which Realtime Database this session talks to. In development this is always
 * the local emulator. In production, a real Firebase project must be configured via
 * VITE_FIREBASE_DATABASE_URL (see .env.example) — the leaderboard and audit trail are
 * required for a deployed build, not an optional feature.
 */
export function initFirebase () {
  if (baseUrl) return

  if (import.meta.env.DEV) {
    baseUrl = EMULATOR_BASE_URL
    namespace = EMULATOR_NAMESPACE
    return
  }

  const databaseURL = import.meta.env.VITE_FIREBASE_DATABASE_URL
  if (!databaseURL) {
    throw new Error(
      '[PuxiAche] Firebase config missing. Copy .env.example to .env and fill in your ' +
      "project's Realtime Database URL before deploying — the leaderboard and audit trail require it."
    )
  }
  baseUrl = databaseURL.replace(/\/+$/, '')
}

/** Builds a REST URL for a database path, e.g. dbUrl('leaderboard', { limitToLast: 20 }). */
function dbUrl (path, params = {}) {
  const url = new URL(`${baseUrl}/${path}.json`)
  if (namespace) url.searchParams.set('ns', namespace)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

/**
 * Submit a finished game's score to the public leaderboard. Entries are append-only.
 * Deliberately doesn't store seed, foundCount, skippedCount, or durationMs — those are
 * already captured in the per-game audit trail (see logAuditEvent), so duplicating them
 * here would just burn into the free plan's storage quota for no benefit.
 */
export async function submitScore ({ name, score, gameId }) {
  const payload = {
    name,
    score,
    gameId,
    ts: Date.now(),
  }
  const res = await fetch(dbUrl('leaderboard'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`submitScore failed: ${res.status}`)
  const { name: entryId } = await res.json()
  return entryId
}

/** Fetch the top N leaderboard entries, highest score first. */
export async function fetchTopScores (count = 20) {
  const res = await fetch(dbUrl('leaderboard', { orderBy: '"score"', limitToLast: count }))
  if (!res.ok) throw new Error(`fetchTopScores failed: ${res.status}`)
  const data = await res.json()
  if (!data) return []
  const rows = Object.entries(data).map(([id, val]) => ({ id, ...val }))
  rows.sort((a, b) => b.score - a.score)
  return rows
}

/**
 * Returns a score's 1-based rank on the leaderboard (competition ranking: ties share a
 * rank), without having to download the whole table — just the count of entries that
 * beat it, via an indexed range query.
 */
export async function fetchScoreRank (score) {
  const res = await fetch(dbUrl('leaderboard', { orderBy: '"score"', startAt: score + 1 }))
  if (!res.ok) throw new Error(`fetchScoreRank failed: ${res.status}`)
  const data = await res.json()
  const beatenByCount = data ? Object.keys(data).length : 0
  return beatenByCount + 1
}

/**
 * Writes one game's whole (compressed) audit trail to /auditEvents/{gameId}. Write-once,
 * one write per game (see database.rules.json and audit.js's AuditTrail.flush) — meant for
 * post-hoc pattern analysis, not as a real-time anti-cheat system.
 * @param {string} gameId
 * @param {{ v: number, playerSeed: number, startedAt: number, codec: string, data: string }} record
 */
export async function logAuditEvent (gameId, record) {
  if (!gameId) return null
  const res = await fetch(dbUrl(`auditEvents/${gameId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  })
  if (!res.ok) throw new Error(`logAuditEvent failed: ${res.status}`)
  return gameId
}
