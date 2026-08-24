/**
 * Compact encoding for finished-game audit trails.
 *
 * The audit trail is stored in Firebase Realtime Database, and this project is
 * intended to remain practical on Firebase's free plan. A finished game can
 * contain many events, so storing the original per-event objects directly would
 * make database storage and transfer grow much faster than necessary as the
 * number of players and completed games increases.
 *
 * This module therefore treats audit trails as a compact wire format rather than
 * normal application JSON. The goal is to preserve everything needed to audit or
 * analyze a finished game while minimizing the number of bytes Firebase has to
 * store and transfer.
 *
 * The encoding pipeline is:
 *
 *   positional event structs
 *     -> MessagePack
 *     -> raw DEFLATE
 *     -> unpadded base64
 *     -> one-character format-version prefix
 *
 * Each layer exists primarily to reduce storage size:
 *
 * - Events are arrays with fixed field positions instead of objects, avoiding
 *   repeated JSON property names such as `type`, `ts`, `code`, etc.
 * - Values duplicated across events are stored only once. `startedAt` and
 *   `playerSeed` live at the record level, `seed` is derivable and is not stored,
 *   round indexes are implied by event order, and event timestamps are stored as
 *   small offsets from `startedAt`.
 * - MessagePack represents the resulting arrays and especially their numeric
 *   values more compactly than JSON's textual representation.
 * - Raw DEFLATE compresses repetition between events without paying for the
 *   gzip/zlib wrapper metadata that is unnecessary for an internal format whose
 *   encoder and decoder we control.
 * - Base64 makes the binary result safe to store as a Realtime Database string;
 *   trailing `=` padding is omitted because the decoder can restore it.
 * - The leading character identifies the complete wire-format version, avoiding
 *   separate `codec`, `version`, or other metadata fields.
 *
 * Current v1 payload before compression:
 *
 *   [
 *     playerSeed,
 *     startedAt,
 *     [
 *       [eventType, t, ...eventFields],
 *       ...
 *     ]
 *   ]
 *
 * `t` is milliseconds since `startedAt`.
 *
 * Persisted representation:
 *
 *   1<base64(raw-deflate(msgpack(payload)))>
 *
 * The version should be changed whenever the binary/layout contract changes so
 * old audit trails can continue to be decoded correctly.
 */
import { makeMessagePackEncoder } from '@urlpack/msgpack'

export const EVENT_TYPE = {
  COUNTRY_SELECTED: 0,
  COUNTRY_FOUND: 1,
  COUNTRY_SKIPPED: 2,
  GAME_END: 3,
}

// One character identifies the complete wire format:
// v1 = MessagePack + raw DEFLATE + unpadded base64.
const FORMAT_VERSION = '1'

const msgpack = makeMessagePackEncoder()

/**
 * MessagePack payload:
 *
 * [
 *   playerSeed,
 *   startedAt,
 *   [
 *     [type, t, ...fields],
 *     ...
 *   ]
 * ]
 */
export function buildAuditRecord ({ playerSeed, startedAt, events }) {
  const packed = []

  for (const e of events) {
    const t = e.ts - startedAt

    switch (e.type) {
      case 'country_selected':
        packed.push([
          EVENT_TYPE.COUNTRY_SELECTED,
          t,
          e.code,
        ])
        break

      case 'country_found':
        packed.push([
          EVENT_TYPE.COUNTRY_FOUND,
          t,
          e.code,
          Math.round(e.elapsedMs),
          Math.round(e.distanceKm),
          e.points,
        ])
        break

      case 'country_skipped':
        packed.push([
          EVENT_TYPE.COUNTRY_SKIPPED,
          t,
          e.code,
          Math.round(e.elapsedMs),
        ])
        break

      case 'game_end':
        packed.push([
          EVENT_TYPE.GAME_END,
          t,
          e.score,
          e.foundCount,
          e.skippedCount,
        ])
        break
    }
  }

  return [playerSeed, startedAt, packed]
}

function uint8ToBase64 (bytes) {
  let binary = ''
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunkSize),
    )
  }

  return btoa(binary).replace(/=+$/, '')
}

export async function encodeAuditRecord (record) {
  const encoded = msgpack.encode(record)

  const stream = new Blob([encoded])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))

  const compressed = new Uint8Array(
    await new Response(stream).arrayBuffer()
  )

  return FORMAT_VERSION + uint8ToBase64(compressed)
}
