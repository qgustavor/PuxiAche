// Synthesized sound effects — no audio files to ship or fetch. Each event plays a short
// simulated-piano melody (fundamental + two quieter overtones per note, through a quick
// plucked envelope) built entirely from WebAudio oscillators.
//
// All melodies live on the G major scale (G A B C D E F#) — the only key where every note
// used below (C, D, E, F#, G, A) is diatonic with no accidentals, which is why F# rather
// than Gb shows up throughout.
const NOTE_FREQS = {
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  'F#4': 369.99,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  'F#5': 739.99,
  G5: 783.99,
  A5: 880.0,
}

const MELODIES = {
  start: ['C4', 'E4', 'D4', 'F#4'],
  skip: ['E4', 'C4'],
  end: ['C4', 'E4', 'D4', 'F#4', 'G4'],
  // 'found' (round win) isn't a fixed melody — see roundWinFreqsForScore below, so it
  // doesn't get repetitive over a 60s run.
}

// Round-win motif: D-F# is the base ("you found one!"), then each further 300-point tier
// climbs one step further up the G major scale — same motif-and-variation idea as the
// D-F# jump itself, just continued: after the initial third (D to F#, skipping E), every
// later step moves by a plain scale step (F#-G, G-A, A-B, ...), so the melody keeps
// climbing rather than repeating, however long the run goes.
const ROUND_WIN_TIER_POINTS = 300
const ROUND_WIN_BASE_SCORE = 100 // the lowest score a "found" event can report
const SCALE_LETTERS_FROM_D = ['D', 'E', 'F#', 'G', 'A', 'B', 'C'] // G major, starting on D
const SEMITONES_FROM_D = { D: 0, E: 2, 'F#': 4, G: 5, A: 7, B: 9, C: 10 }
const D4_FREQ = NOTE_FREQS.D4

function scaleSlotFreq (slot) {
  const letter = SCALE_LETTERS_FROM_D[((slot % 7) + 7) % 7]
  const octaveUp = Math.floor(slot / 7)
  const semitone = SEMITONES_FROM_D[letter] + 12 * octaveUp
  return D4_FREQ * Math.pow(2, semitone / 12)
}

/** anchor(0) = D; anchor(n>=1) continues stepwise up the scale starting from F# (anchor(1) = F#). */
function anchorFreq (tier) {
  const slot = tier === 0 ? 0 : tier + 1
  return scaleSlotFreq(slot)
}

/** The two-note round-win motif for the player's current total score. */
export function roundWinFreqsForScore (score) {
  const tier = Math.max(0, Math.floor((score - ROUND_WIN_BASE_SCORE) / ROUND_WIN_TIER_POINTS))
  return [anchorFreq(tier), anchorFreq(tier + 1)]
}

const NOTE_DURATION_S = 0.16
const NOTE_GAP_S = 0.03
const MASTER_GAIN = 0.35

let enabled = false
let ctx = null

function getContext () {
  if (!ctx) {
    if (!window.AudioContext) return null
    ctx = new window.AudioContext()
  }
  // Browsers suspend new contexts until a user gesture resumes them — setSoundEnabled is
  // always called from one (the player toggling sound on), so this is a safe place to ask.
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ })
  return ctx
}

/** Call once with the persisted preference, and again whenever the player toggles it. */
export function setSoundEnabled (value) {
  enabled = value
  if (value) getContext()
}

/** Plays one simulated-piano note: fundamental + two quieter overtones, short pluck envelope. */
function playNote (audioCtx, freq, startTime, destination) {
  const partials = [
    { mult: 1, gain: 0.9 },
    { mult: 2, gain: 0.28 },
    { mult: 3, gain: 0.12 },
  ]
  for (const { mult, gain } of partials) {
    const osc = audioCtx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq * mult

    const env = audioCtx.createGain()
    env.gain.setValueAtTime(0, startTime)
    env.gain.linearRampToValueAtTime(gain, startTime + 0.008) // fast pluck attack
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + NOTE_DURATION_S) // decay

    osc.connect(env)
    env.connect(destination)
    osc.start(startTime)
    osc.stop(startTime + NOTE_DURATION_S + 0.02)
  }
}

/** Plays a sequence of frequencies (Hz) as notes, back to back. Shared by playSound/playRoundWin. */
function playFreqSequence (freqs) {
  if (!enabled || !freqs || freqs.length === 0) return
  const audioCtx = getContext()
  if (!audioCtx) return

  const master = audioCtx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(audioCtx.destination)

  let t = audioCtx.currentTime + 0.01
  for (const freq of freqs) {
    playNote(audioCtx, freq, t, master)
    t += NOTE_DURATION_S + NOTE_GAP_S
  }
}

/**
 * Plays a named melody (see MELODIES): 'start', 'skip', or 'end'. No-ops if sound is off,
 * WebAudio is unavailable, or the name isn't one of those (use playRoundWin for 'found').
 */
export function playSound (name) {
  const notes = MELODIES[name]
  if (!notes) return
  playFreqSequence(notes.map((n) => NOTE_FREQS[n]).filter(Boolean))
}

/** Plays the round-win ("found") motif, pitched to the player's current total score. */
export function playRoundWin (score) {
  playFreqSequence(roundWinFreqsForScore(score))
}
