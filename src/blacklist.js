// A basic, non-exhaustive profanity filter for player nicknames.
// This is intentionally simple (substring match on normalized text) — it
// exists to catch obvious cases for a children's leaderboard, not to be a
// bulletproof moderation system. Extend as needed.

// "Reasonable for a first and last name" — without a cap, players could (and did) type
// gibberish walls of text into the name field and break the leaderboard UI for everyone.
export const MAX_NAME_LENGTH = 16

const BLOCKED_TERMS = [
  // English
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy', 'cunt',
  'nigger', 'nigga', 'fag', 'faggot', 'whore', 'slut', 'rape', 'nazi',
  'hitler', 'kys', 'retard',
  // Portuguese
  'porra', 'merda', 'caralho', 'puta', 'puto', 'foda', 'fodase', 'foda-se',
  'cabrao', 'cabrão', 'cacete', 'piroca', 'pica', 'buceta', 'viado', 'bicha',
  'corno', 'arrombado', 'desgraca', 'desgraça', 'retardado',
]

function normalize (str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]/g, '') // strip spaces/punctuation to catch spacing tricks
}

/** Returns true if the given nickname should be rejected. */
export function isNameBlocked (name) {
  if (!name || typeof name !== 'string') return true
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return true

  const normalized = normalize(trimmed)
  if (normalized.length === 0) return true

  return BLOCKED_TERMS.some((term) => normalized.includes(normalize(term)))
}

/** Basic shape validation independent of the blacklist (letters/digits/space/-/_). */
export function isNameShapeValid (name) {
  return typeof name === 'string' && new RegExp(`^[A-Za-zÀ-ÿ0-9 _-]{1,${MAX_NAME_LENGTH}}$`).test(name.trim())
}
