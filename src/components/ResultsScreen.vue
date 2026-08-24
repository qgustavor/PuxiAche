<template>
  <section class="screen">
    <canvas
      ref="confettiCanvas"
      class="confetti-canvas"
      aria-hidden="true"
    />
    <div
      class="results-card"
      :class="{ 'shake-hyped': shakeActive }"
    >
      <template v-if="submitStatus !== 'success'">
        <h2>{{ $t('results.title') }}</h2>
        <div class="results-score">
          <span class="results-score-label">{{ $t('results.scoreLabel') }}</span>
          <span class="results-score-value">
            <span class="results-score-number">
              {{ displayScore }}
            </span>
            <span
              class="results-score-placeholder"
              aria-hidden="true"
            >
              {{ summary?.score ?? 0 }}
            </span>
          </span>
        </div>

        <p
          v-if="isPersonalBest"
          class="personal-best-badge"
        >
          <Trophy :size="18" :stroke-width="2" aria-hidden="true" /> {{ $t('results.personalBest') }}
        </p>

        <div class="results-sub">
          {{ $t('results.foundLabel') }}: {{ summary?.foundCount ?? 0 }}<br>
          {{ $t('results.skippedLabel') }}: {{ summary?.skippedCount ?? 0 }}
        </div>

        <div class="name-entry">
          <label for="player-name">{{ $t('results.namePrompt') }}</label>
          <input
            id="player-name"
            v-model="name"
            type="text"
            :maxlength="MAX_NAME_LENGTH"
            autocomplete="off"
            :placeholder="$t('results.namePlaceholder')"
            @keyup.enter="submit"
          >
          <p
            v-if="showLengthHint"
            class="name-hint"
          >
            {{ $t('results.nameHint') }}
          </p>
          <p
            v-if="showNameError"
            class="name-error"
          >
            {{ $t('results.nameRejected') }}
          </p>
          <button
            class="btn btn-primary"
            type="button"
            :disabled="submitStatus === 'pending'"
            @click="submit"
          >
            {{ $t('results.submit') }}
          </button>
          <p
            v-if="submitStatus === 'error'"
            class="submit-status"
          >
            {{ $t('results.submitError') }}
          </p>
        </div>
      </template>

      <template v-else>
        <div
          v-if="isHighScore"
          ref="highscoreBannerEl"
          class="highscore-banner"
          aria-live="polite"
        />
        <p
          v-else-if="isPersonalBest"
          class="personal-best-badge"
        >
          <Trophy :size="18" :stroke-width="2" aria-hidden="true" /> {{ $t('results.personalBest') }}
        </p>

        <h2 class="results-postsubmit-title">
          {{ $t('leaderboard.title') }}
        </h2>
        <div id="results-leaderboard-body">
          <p v-if="postSubmitStatus === 'loading'">
            {{ $t('leaderboard.loading') }}
          </p>
          <p v-else-if="postSubmitStatus === 'error'">
            {{ $t('leaderboard.error') }}
          </p>
          <p v-else-if="postSubmitStatus === 'empty'">
            {{ $t('leaderboard.empty') }}
          </p>
          <div v-else>
            <div
              v-for="(row, i) in postSubmitRows"
              :key="row.id"
              class="lb-row"
              :class="{ 'lb-row-you': row.id === youEntryId }"
            >
              <span class="lb-rank">{{ i + 1 }}</span>
              <span class="lb-name">{{ row.name }}<span
                v-if="row.id === youEntryId"
                class="lb-you-tag"
              >{{ $t('leaderboard.you') }}</span></span>
              <span class="lb-score">{{ row.score }}</span>
            </div>

            <template v-if="youRank && !youInPostSubmitRows">
              <div
                class="lb-ellipsis"
                aria-hidden="true"
              >
                ···
              </div>
              <div class="lb-row lb-row-you">
                <span class="lb-rank">{{ youRank }}</span>
                <span class="lb-name">{{ name }}<span class="lb-you-tag">{{ $t('leaderboard.you') }}</span></span>
                <span class="lb-score">{{ summary?.score ?? 0 }}</span>
              </div>
            </template>
          </div>
        </div>
      </template>

      <div class="results-actions">
        <button
          class="btn"
          :class="submitStatus === 'success' ? 'btn-primary' : 'btn-secondary'"
          type="button"
          @click="$emit('play-again')"
        >
          {{ $t('results.playAgain') }}
        </button>
        <button
          class="btn btn-secondary"
          type="button"
          @click="$emit('back-to-menu')"
        >
          {{ $t('results.backToMenu') }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { animate, utils } from 'animejs'
import { isNameBlocked, isNameShapeValid, MAX_NAME_LENGTH } from '../blacklist.js'
import confetti from 'canvas-confetti'
import { Trophy } from 'lucide-vue-next'

const props = defineProps({
  summary: { type: Object, default: null },
  submitStatus: { type: String, default: 'idle' }, // idle | pending | success | error
  isPersonalBest: { type: Boolean, default: false },
  postSubmitRows: { type: Array, default: () => [] },
  postSubmitStatus: { type: String, default: 'idle' }, // idle | loading | ready | empty | error
  isHighScore: { type: Boolean, default: false },
  youEntryId: { type: String, default: null },
  youRank: { type: Number, default: null },
})
const emit = defineEmits(['play-again', 'back-to-menu', 'submit'])

const { t } = useI18n()

// Remembers the last name the player entered, so they don't have to retype it every game.
const NAME_KEY = 'gd_playerName'
function loadStoredName () {
  try { return localStorage.getItem(NAME_KEY) || '' } catch (e) { return '' }
}
function persistName (value) {
  try { localStorage.setItem(NAME_KEY, value) } catch (e) { /* ignore */ }
}

const name = ref(loadStoredName())
const showNameError = ref(false)
// Only nag about the character limit once the player is actually close to it — showing
// it unconditionally under a short name field is just noise.
const NEAR_LIMIT_CHARS = 3
const showLengthHint = computed(() => name.value.length >= MAX_NAME_LENGTH - NEAR_LIMIT_CHARS)

const youInPostSubmitRows = computed(() => props.postSubmitRows.some((r) => r.id === props.youEntryId))

// Counts the score up from 0 on reveal instead of just plopping the final number in.
// Skipped (jumps straight to the final value) if the user prefers reduced motion.
const displayScore = ref(0)
let countUpRaf = null
const COUNT_UP_BASE_MS = 700
const COUNT_UP_FACTOR_MS = 100
const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

function animateScoreCountUp (target) {
  if (countUpRaf) cancelAnimationFrame(countUpRaf)
  if (prefersReducedMotion) {
    displayScore.value = target
    return
  }
  const start = performance.now()
  const from = 0
  const duration = COUNT_UP_BASE_MS + Math.log2(target) * COUNT_UP_FACTOR_MS
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - p, 3) // ease-out cubic
    displayScore.value = Math.round(from + (target - from) * eased)
    if (p < 1) {
      countUpRaf = requestAnimationFrame(step)
    } else {
      countUpRaf = null
    }
  }
  countUpRaf = requestAnimationFrame(step)
}

// Reset the form whenever a fresh summary comes in (i.e. a new game ended).
watch(
  () => props.summary,
  (summary) => {
    name.value = loadStoredName()
    showNameError.value = false
    animateScoreCountUp(summary?.score ?? 0)
  },
  { immediate: true }
)

function submit () {
  const trimmed = name.value.trim()
  if (!isNameShapeValid(trimmed) || isNameBlocked(trimmed)) {
    showNameError.value = true
    return
  }
  showNameError.value = false
  persistName(trimmed)
  emit('submit', trimmed)
}

// ---------- Confetti ----------
const confettiCanvas = ref(null)
let fireConfetti = null

onMounted(() => {
  if (confettiCanvas.value) {
    fireConfetti = confetti.create(confettiCanvas.value, { resize: true, useWorker: true })
  }
  if ((props.summary?.score ?? 0) > 0) burstConfetti()
})

function burstConfetti () {
  if (!fireConfetti || prefersReducedMotion) return
  fireConfetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 45
  })
}

// A single, warmer burst — "nice, your best yet" rather than "the whole screen is on fire".
function burstConfettiPersonalBest () {
  if (!fireConfetti || prefersReducedMotion) return
  fireConfetti({
    particleCount: 70,
    spread: 70,
    startVelocity: 38,
    colors: ['#f5a623', '#ffe08a', '#fff2cc'],
  })
}

// The big one: several staggered bursts from different spots on screen, Balatro-loud —
// this is the one moment in the whole app that's allowed to go over the top.
const HYPE_COLORS = ['#f5a623', '#f26d6d', '#2fd6c0', '#4ade80']
function burstConfettiHype () {
  if (!fireConfetti || prefersReducedMotion) return
  fireConfetti({ particleCount: 150, spread: 100, startVelocity: 58, colors: HYPE_COLORS, origin: { y: 0.55 } })
  setTimeout(() => fireConfetti?.({ particleCount: 90, angle: 60, spread: 65, startVelocity: 48, colors: HYPE_COLORS, origin: { x: 0.05, y: 0.6 } }), 180)
  setTimeout(() => fireConfetti?.({ particleCount: 90, angle: 120, spread: 65, startVelocity: 48, colors: HYPE_COLORS, origin: { x: 0.95, y: 0.6 } }), 180)
  setTimeout(() => fireConfetti?.({ particleCount: 120, spread: 130, startVelocity: 62, colors: HYPE_COLORS, origin: { y: 0.5 } }), 480)
}

onBeforeUnmount(() => {
  fireConfetti?.reset()
})

// ---------- "New high score!" letter-by-letter reveal (Balatro-inspired: bouncy
// per-letter entrance + a constant little color/motion pulse once settled) ----------
const highscoreBannerEl = ref(null)
const shakeActive = ref(false)

function buildHighScoreBanner () {
  const el = highscoreBannerEl.value
  if (!el) return
  el.innerHTML = ''
  const letters = t('results.highScoreTitle').split('').map((ch) => {
    const span = document.createElement('span')
    span.className = 'highscore-letter'
    span.textContent = ch === ' ' ? '\u00A0' : ch
    span.style.setProperty('--bob-delay', `${Math.random() * 0.7}s`)
    return span
  })
  letters.forEach((span) => el.appendChild(span))
  if (prefersReducedMotion) return
  letters.forEach((span, i) => {
    animate(span, {
      opacity: [0, 1],
      scale: [0.2, 1],
      rotate: [utils.random(-50, 50), 0],
      y: [utils.random(-24, 24), 0],
      duration: utils.random(420, 620),
      delay: i * 35 + utils.random(0, 60),
      ease: 'outBack',
    })
  })
}

function triggerHighScoreCelebration () {
  buildHighScoreBanner()
  burstConfettiHype()
  if (prefersReducedMotion) return
  shakeActive.value = false
  // Restart the shake even if it somehow triggers twice in a row.
  requestAnimationFrame(() => {
    shakeActive.value = true
    setTimeout(() => { shakeActive.value = false }, 600)
  })
}

// Fires once, right when the submit response tells us whether this was a high score or
// "just" a personal best.
watch(
  () => props.submitStatus,
  async (status) => {
    if (status !== 'success') return
    await nextTick()
    if (props.isHighScore) {
      triggerHighScoreCelebration()
    } else if (props.isPersonalBest) {
      burstConfettiPersonalBest()
    }
  }
)
</script>
