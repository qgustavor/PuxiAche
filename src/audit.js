import { logAuditEvent } from './firebase.js'
import { buildAuditRecord, encodeAuditRecord } from './audit-codec.js'

/**
 * Records gameplay events for a single game session, in-memory, so the developer can
 * audit patterns later (e.g. suspiciously constant reaction times, or leaderboard entries
 * with no matching audit trail). Events are buffered for the whole session and sent to
 * Firebase Realtime Database as a single compressed write when the game ends — not one
 * network write per event during play, which is wasted bandwidth for a trail nobody reads
 * until well after the round is over.
 */
export class AuditTrail {
  /**
   * @param {string} gameId
   * @param {number} [startedAt] - wall-clock time (Date.now()) the session began, i.e. the
   *   same value used to derive this session's RNG seed alongside `playerSeed`. A later
   *   auditor can recompute the seed from playerSeed+startedAt to confirm it wasn't
   *   tampered with, without it needing to be logged separately (see deriveGameSeed).
   * @param {number} [playerSeed]
   */
  constructor (gameId, startedAt = Date.now(), playerSeed = null) {
    this.gameId = gameId
    this.startedAt = startedAt
    this.playerSeed = playerSeed
    this.events = []
  }

  log (type, payload = {}) {
    const event = { type, ...payload, ts: Date.now() }
    this.events.push(event)
    return event
  }

  getEvents () {
    return this.events
  }

  /**
   * Compresses the whole buffered trail and sends it in one write. Best-effort/
   * fire-and-forget: gameplay, and whoever calls this (typically right as the game ends),
   * must never wait on or be blocked by this.
   */
  async flush () {
    try {
      const record = buildAuditRecord({
        playerSeed: this.playerSeed,
        startedAt: this.startedAt,
        events: this.events,
      })
      const data = await encodeAuditRecord(record)
      await logAuditEvent(this.gameId, data)
    } catch (err) {
      console.warn('[PuxiAche] audit log failed', err)
    }
  }
}

/** Generates a reasonably unique session id to correlate leaderboard <-> audit trail. */
export function generateGameId () {
  const rand = Math.random().toString(36).slice(2, 10)
  return `g_${Date.now().toString(36)}_${rand}`
}
