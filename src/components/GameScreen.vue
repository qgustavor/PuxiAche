<template>
  <section
    ref="screenEl"
    class="screen"
  >
    <div class="hud hud-top">
      <div
        ref="findLabelEl"
        class="find-label"
      >
        <div
          ref="findBgEl"
          class="find-label-bg"
          aria-hidden="true"
        />
        <span class="find-eyebrow">{{ $t('game.find') }}</span>
        <div
          ref="findWrapEl"
          class="find-country-wrap"
        />
      </div>

      <div
        v-if="nextName"
        ref="nextLabelEl"
        class="next-label"
      >
        <div
          ref="nextBgEl"
          class="next-label-bg"
          aria-hidden="true"
        />
        <span class="next-eyebrow">{{ $t('game.next') }}</span>
        <div
          ref="nextWrapEl"
          class="next-country"
        />
      </div>
    </div>

    <div
      class="reticle"
      aria-hidden="true"
    />

    <div
      class="found-toast"
      :class="{ show: toast.visible }"
    >
      {{ toast.text }}
    </div>

    <div class="hud hud-bottom">
      <div class="hud-stats">
        <div class="stat">
          <span class="stat-label">{{ $t('game.score') }}</span>
          <span
            :key="score"
            class="stat-value score-value"
          >{{ score }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{{ $t('game.time') }}</span>
          <span
            class="stat-value time-value"
            :class="{ 'time-low': isTimeLow }"
          >{{ remainingSeconds }}</span>
        </div>
        <button
          id="btn-skip"
          class="btn btn-ghost"
          type="button"
          @click="$emit('skip')"
        >
          {{ $t('game.skip') }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { animate, utils } from 'animejs'

const props = defineProps({
  targetName: { type: String, default: '' },
  special: { type: Boolean, default: false },
  nextName: { type: String, default: '' },
  nextSpecial: { type: Boolean, default: false },
  roundIndex: { type: Number, default: 0 },
  lastOutcome: { type: String, default: null }, // 'found' | 'skip' | null
  score: { type: Number, default: 0 },
  remainingSeconds: { type: Number, default: 0 },
  remainingMs: { type: Number, default: 0 },
  totalMs: { type: Number, default: 60000 },
  toast: { type: Object, default: () => ({ visible: false, text: '' }) },
})
defineEmits(['skip'])

const TIME_LOW_MS = 10000
const isTimeLow = computed(() => props.remainingMs > 0 && props.remainingMs <= TIME_LOW_MS)

// ---------- Balatro-inspired word animation ----------
// The "next" preview word is always exactly what's about to become the "find" word
// (see game.js's _promote), so a round change is animated as:
//   1. the outgoing "find" word is duplicated into a fixed-position clone, which
//      animates out on its own (up+fade if found, blur+fade if skipped) with each
//      letter getting a randomized delay/duration — the clone is disposable, so the
//      live letters underneath are never touched by more than one animation;
//   2. each preview letter's on-screen position and size is measured before that
//      slot is cleared, the find slot's word is (re)built fresh, and each new letter
//      is placed with the measured delta from its preview counterpart, then animated
//      back to identity — a letter near the edge of a long word visibly travels
//      further sideways than one near the middle;
//   3. the find/next pill backgrounds animate their width/height to fit whatever text
//      just landed in them;
//   4. the next slot then pops in the new preview word, letter by letter.
// The DOM here is built and animated by hand (rather than Vue's v-for/<Transition>) so we
// can measure real element positions/sizes for the FLIP move and randomize each letter
// individually — a CSS `animation` can't do either of those.

const findWrapEl = ref(null)
const nextWrapEl = ref(null)
const findLabelEl = ref(null)
const nextLabelEl = ref(null)
const findBgEl = ref(null)
const nextBgEl = ref(null)
const screenEl = ref(null)
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function buildLetterSpans (text, className, special = false) {
  return (text || '').split('').map((ch) => {
    const span = document.createElement('span')
    span.className = special ? `${className} special` : className
    span.textContent = ch === ' ' ? '\u00A0' : ch
    return span
  })
}

function buildStar (extraClass = '') {
  const star = document.createElement('span')
  star.className = extraClass ? `find-star ${extraClass}` : 'find-star'
  star.setAttribute('aria-hidden', 'true')
  star.textContent = '★'
  return star
}

/** Animates a pill's decorative background layer from its old width/height to
 *  whatever the label currently measures, so the background visibly grows or
 *  shrinks to fit the text. The label itself is never resized, so the text inside
 *  it always lays out at its natural, correctly centered size. */
function animatePillResize (labelEl, bgEl, oldSize, duration) {
  if (!labelEl || !bgEl) return
  const newSize = { width: labelEl.offsetWidth, height: labelEl.offsetHeight }
  if (reduceMotion || !oldSize) {
    utils.remove(bgEl)
    utils.set(bgEl, { width: newSize.width, height: newSize.height })
    return
  }
  utils.remove(bgEl)
  utils.set(bgEl, { width: oldSize.width, height: oldSize.height })
  animate(bgEl, {
    width: newSize.width,
    height: newSize.height,
    duration,
    ease: 'outQuad',
  })
}

/** Reads a label's current natural footprint, to use as the "old" size on the next
 *  call to animatePillResize. */
function measurePillSize (labelEl) {
  if (!labelEl) return null
  return { width: labelEl.offsetWidth, height: labelEl.offsetHeight }
}

/** Reveals a container's letters with opacity + a short drift, giving each letter its
 *  own randomized delay and duration rather than an evenly-spaced stagger, so the
 *  reveal reads as a scatter of individual letters rather than one uniform sweep. */
function popInLetters (container, { fromY, fromScale = null, minDuration, maxDuration, maxDelay }) {
  Array.from(container.children).forEach((el) => {
    animate(el, {
      opacity: [0, 1],
      y: [fromY, 0],
      ...(fromScale != null ? { scale: [fromScale, 1] } : {}),
      duration: reduceMotion ? 0 : utils.random(minDuration, maxDuration),
      delay: reduceMotion ? 0 : utils.random(0, maxDelay),
      ease: reduceMotion ? 'linear' : 'outBack',
    })
  })
}

/** First paint: no outgoing word to animate, just pop the words in. */
function renderInitialRound () {
  const findEl = findWrapEl.value
  const nextEl = nextWrapEl.value

  if (findEl) {
    findEl.innerHTML = ''
    buildLetterSpans(props.targetName, 'find-letter', props.special).forEach((el) => findEl.appendChild(el))
    if (props.special) findEl.appendChild(buildStar())
    popInLetters(findEl, { fromY: 14, fromScale: 0.6, minDuration: 340, maxDuration: 500, maxDelay: 260 })
    animatePillResize(findLabelEl.value, findBgEl.value, null, 0)
  }

  if (nextEl && props.nextName) {
    nextEl.innerHTML = ''
    buildLetterSpans(props.nextName, 'next-letter', props.nextSpecial).forEach((el) => nextEl.appendChild(el))
    if (props.nextSpecial) nextEl.appendChild(buildStar('small'))
    popInLetters(nextEl, { fromY: 10, minDuration: 260, maxDuration: 380, maxDelay: 200 })
    animatePillResize(nextLabelEl.value, nextBgEl.value, null, 0)
  }
}

/** Every subsequent round: animate the old word out, FLIP the preview word into place,
 *  resize both pills to fit, then pop in the brand-new preview word. Runs fully
 *  synchronously (no await) so that a fast second round change can't start executing
 *  while this one is still mid-flight and end up operating on the same DOM nodes. */
function animateRoundChange (outcome) {
  const findEl = findWrapEl.value
  const nextEl = nextWrapEl.value
  const findLabel = findLabelEl.value
  const nextLabel = nextLabelEl.value
  if (!findEl) return

  const oldFindPillSize = measurePillSize(findLabel)
  // Captured now, before the label is repopulated: .find-label is centered and
  // auto-sized to its content, so as soon as a much longer word lands in it the
  // label's own box grows and shifts. .screen spans the full viewport and never
  // resizes based on word length, so anchoring the exit clone to it (rather than
  // to .find-label) means it stays exactly where the outgoing word was.
  const screenRect = screenEl.value ? screenEl.value.getBoundingClientRect() : null
  const findRect = findEl.getBoundingClientRect()

  // Duplicate the outgoing word into a clone parented in .screen and animate the
  // clone instead of the live letters. The clone is disposable, so it can't pick
  // up leftover animation state, and the letters it's built from are never
  // targeted by more than one animation.
  if (findEl.children.length && screenRect) {
    const clone = findEl.cloneNode(true)
    const positioner = document.createElement('div')
    positioner.setAttribute('aria-hidden', 'true')
    Object.assign(positioner.style, {
      position: 'absolute',
      left: `${findRect.left - screenRect.left + findRect.width / 2}px`,
      top: `${findRect.top - screenRect.top + findRect.height / 2}px`,
      transform: 'translate(-50%, -50%)',
      margin: '0',
      zIndex: '16',
      pointerEvents: 'none',
    })
    positioner.appendChild(clone)
    screenEl.value.appendChild(positioner)
    Array.from(clone.children).forEach((letter) => {
      // Force a clean baseline on the clone, in case the source letter's own
      // entrance animation hadn't fully settled by the time it was cloned.
      letter.style.opacity = '1'
      letter.style.transform = 'none'
      letter.style.filter = 'none'
      // Both outcomes float up and fade the same way; color is the only signal
      // that distinguishes them, so the old word clears out of the way quickly
      // and consistently instead of lingering and overlapping the new one.
      const startColor = getComputedStyle(letter).color
      const endColor = outcome === 'skip' ? '#f26d6d' : '#4ade80'
      animate(letter, {
        opacity: [1, 0],
        color: [startColor, endColor],
        y: -utils.random(18, 36),
        scale: [1, 0.85],
        duration: reduceMotion ? 0 : utils.random(260, 420),
        delay: reduceMotion ? 0 : utils.random(0, 200),
        ease: 'inQuad',
      })
    })
    setTimeout(() => positioner.remove(), reduceMotion ? 0 : 900)
  }

  // Measure each preview letter's real on-screen position and size before this
  // slot gets cleared, so the corresponding find-slot letter can FLIP in from that
  // exact spot rather than from a single shared word-level offset.
  const previewLetters = nextEl ? Array.from(nextEl.children).filter((el) => !el.classList.contains('find-star')) : []
  const previewRects = previewLetters.map((el) => el.getBoundingClientRect())
  if (nextEl) nextEl.innerHTML = ''

  // Build the find slot's word fresh (never reusing letters from the preview slot)
  // and resize its pill to fit.
  findEl.innerHTML = ''
  buildLetterSpans(props.targetName, 'find-letter', props.special).forEach((el) => findEl.appendChild(el))
  const newLetters = Array.from(findEl.children)
  if (props.special) {
    const star = buildStar()
    findEl.appendChild(star)
    animate(star, {
      opacity: [0, 1],
      scale: [0.4, 1],
      duration: reduceMotion ? 0 : 400,
      delay: reduceMotion ? 0 : 220,
      ease: 'outBack',
    })
  }

  animatePillResize(findLabel, findBgEl.value, oldFindPillSize, reduceMotion ? 0 : 500)

  if (previewRects.length > 0 && previewRects.length === newLetters.length) {
    // Each letter gets its own measured delta from its preview-slot counterpart, so
    // a letter near the edge of a long word travels further sideways than one near
    // the middle, instead of the whole word moving as one rigid block.
    newLetters.forEach((letter, i) => {
      const fromRect = previewRects[i]
      const toRect = letter.getBoundingClientRect()
      const scale = fromRect.width / toRect.width
      const dx = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2)
      const dy = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2)
      utils.set(letter, { x: dx, y: dy, scale })
      animate(letter, {
        x: 0,
        y: 0,
        scale: 1,
        duration: reduceMotion ? 0 : utils.random(360, 460),
        delay: reduceMotion ? 0 : utils.random(0, 80),
        ease: reduceMotion ? 'linear' : 'outBack',
      })
    })
  } else {
    // No matching preview word to FLIP from (e.g. the very first transition) —
    // fall back to a plain pop-in.
    popInLetters(findEl, { fromY: 14, fromScale: 0.6, minDuration: 340, maxDuration: 460, maxDelay: 140 })
  }

  // Pop the brand-new preview word into the now-empty next slot, resizing its pill
  // to fit and revealing the letters with randomized per-letter timing.
  if (nextEl && props.nextName) {
    const oldNextPillSize = measurePillSize(nextLabel)

    buildLetterSpans(props.nextName, 'next-letter', props.nextSpecial).forEach((el) => nextEl.appendChild(el))
    if (props.nextSpecial) nextEl.appendChild(buildStar('small'))

    animatePillResize(nextLabel, nextBgEl.value, oldNextPillSize, reduceMotion ? 0 : 480)

    popInLetters(nextEl, { fromY: 10, fromScale: 0.7, minDuration: 260, maxDuration: 380, maxDelay: 140 })
  }
}

onMounted(renderInitialRound)
watch(() => props.roundIndex, () => animateRoundChange(props.lastOutcome))
</script>
