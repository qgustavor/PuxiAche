<template>
  <div
    id="app"
    :data-theme="theme"
  >
    <div
      id="starfield"
      aria-hidden="true"
    />
    <GlobeCanvas
      ref="globeRef"
      :theme="theme"
    />

    <Transition name="topbar-slide">
      <TopBar
        v-if="screen !== 'game'"
        :theme="theme"
        :sound-enabled="soundEnabled"
        @toggle-theme="toggleTheme"
        @toggle-sound="toggleSound"
        @open-info="infoOpen = true"
      />
    </Transition>

    <InfoModal
      v-if="infoOpen"
      @close="infoOpen = false"
      @open-tutorial="handleReopenTutorial"
    />

    <TitleScreen
      v-if="screen === 'title'"
      @play="handlePlayClick"
      @rankings="openLeaderboard"
    />

    <GameScreen
      v-else-if="screen === 'game'"
      :target-name="hud.targetName"
      :special="hud.special"
      :next-name="hud.nextName"
      :next-special="hud.nextSpecial"
      :round-index="hud.roundIndex"
      :last-outcome="hud.lastOutcome"
      :score="hud.score"
      :remaining-seconds="hud.remainingSeconds"
      :remaining-ms="hud.remainingMs"
      :total-ms="GAME_DURATION_MS"
      :toast="hud.toast"
      @skip="handleSkip"
    />

    <ResultsScreen
      v-else-if="screen === 'results'"
      :summary="resultsSummary"
      :submit-status="submitStatus"
      :is-personal-best="isPersonalBest"
      :post-submit-rows="postSubmitRows"
      :post-submit-status="postSubmitStatus"
      :is-high-score="isHighScore"
      :you-entry-id="youEntryId"
      :you-rank="youRank"
      @submit="handleSubmitScore"
      @play-again="beginGame"
      @back-to-menu="screen = 'title'"
    />

    <LeaderboardScreen
      v-else-if="screen === 'leaderboard'"
      :rows="leaderboardRows"
      :status="leaderboardStatus"
      :you-entry-id="leaderboardYouEntryId"
      :you-rank="leaderboardYouRank"
      :you-name="leaderboardYouName"
      :you-score="leaderboardYouScore"
      @back="screen = 'title'"
    />

    <TutorialModal
      v-if="tutorialOpen"
      @start="handleTutorialStart"
      @close="tutorialOpen = false"
    />
  </div>
</template>

<script setup>
import { reactive, ref, onMounted, watch } from 'vue'
import { useStorage, usePreferredDark, useEventListener } from '@vueuse/core'
import GlobeCanvas from './components/GlobeCanvas.vue'
import TopBar from './components/TopBar.vue'
import TitleScreen from './components/TitleScreen.vue'
import GameScreen from './components/GameScreen.vue'
import ResultsScreen from './components/ResultsScreen.vue'
import LeaderboardScreen from './components/LeaderboardScreen.vue'
import TutorialModal from './components/TutorialModal.vue'
import InfoModal from './components/InfoModal.vue'
import { GameSession, GAME_DURATION_MS, isSpecialCountry, loadGameData } from './game.js'
import { i18n } from './i18n.js'
import { initFirebase, submitScore, fetchTopScores, fetchScoreRank } from './firebase.js'
import { setSoundEnabled, playSound, playRoundWin } from './audio.js'

// ---------- Theme ----------
const prefersDark = usePreferredDark()
const theme = useStorage('gd_theme', prefersDark.value ? 'dark' : 'light')
document.documentElement.setAttribute('data-theme', theme.value)
watch(theme, (val) => document.documentElement.setAttribute('data-theme', val))
function toggleTheme () {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

// ---------- Sound ----------
// Off by default (see audio.js) — the player has to opt in.
const soundEnabled = useStorage('gd_sound', false)
watch(soundEnabled, (val) => setSoundEnabled(val), { immediate: true })
function toggleSound () {
  soundEnabled.value = !soundEnabled.value
}

// ---------- Local play stats (personal best) ----------
// Purely local — distinct from the global leaderboard "high score". Only worth
// announcing once there's a little history behind it (see isPersonalBest below).
const gamesPlayed = useStorage('gd_gamesPlayed', 0)
const bestScoreLocal = useStorage('gd_bestScore', 0)
const isPersonalBest = ref(false)
const MIN_GAMES_FOR_PERSONAL_BEST = 3

// ---------- Last leaderboard submission (so re-opening Rankings later can still show
// "you") ----------
const LAST_SUBMISSION_KEY = 'gd_lastSubmission'
function loadLastSubmission () {
  try {
    const raw = localStorage.getItem(LAST_SUBMISSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) { return null }
}
function saveLastSubmission (value) {
  try { localStorage.setItem(LAST_SUBMISSION_KEY, JSON.stringify(value)) } catch (e) { /* ignore */ }
}

// ---------- Screen state ----------
const screen = ref('title')
const globeRef = ref(null)
const tutorialOpen = ref(false)
const infoOpen = ref(false)

// The tutorial always persists as "seen" once it's been shown — there's no checkbox for it.
// Players can re-open it any time from the info modal instead.
const tutorialSkipped = useStorage('gd_skipTutorial', false)

async function handlePlayClick () {
  if (tutorialSkipped.value) {
    await beginGame()
  } else {
    tutorialOpen.value = true
  }
}
async function handleTutorialStart () {
  tutorialSkipped.value = true
  tutorialOpen.value = false
  await beginGame()
}
function handleReopenTutorial () {
  infoOpen.value = false
  tutorialOpen.value = true
}

// ---------- Game loop ----------
const hud = reactive({
  targetName: '',
  special: false,
  nextName: '',
  nextSpecial: false,
  roundIndex: 0,
  lastOutcome: null, // 'found' | 'skip' | null — drives which HUD transition plays
  score: 0,
  remainingSeconds: Math.ceil(GAME_DURATION_MS / 1000),
  remainingMs: GAME_DURATION_MS,
  toast: { visible: false, text: '' },
})
let session = null
let rafHandle = null
let lastPollT = 0
let toastTimer = null
let currentTargetCountry = null

function countryName (country) {
  return country[i18n.global.locale.value] || country.en
}

async function beginGame () {
  // Download/parse the heavy country boundary data right before transitioning
  await loadGameData()

  screen.value = 'game'
  globeRef.value?.setMode({ interactive: true, autoRotateRpm: 0 })
  hud.score = 0
  hud.remainingSeconds = Math.ceil(GAME_DURATION_MS / 1000)
  hud.remainingMs = GAME_DURATION_MS
  hud.lastOutcome = null
  globeRef.value?.setCountdownProgress(1)
  playSound('start')

  session = new GameSession({
    onRoundChange: ({ country, nextCountry, index }) => {
      currentTargetCountry = country
      hud.targetName = countryName(country)
      hud.special = isSpecialCountry(country)
      hud.nextName = nextCountry ? countryName(nextCountry) : ''
      hud.nextSpecial = nextCountry ? isSpecialCountry(nextCountry) : false
      hud.roundIndex = index
    },
    onFound: ({ points, score }) => {
      hud.lastOutcome = 'found'
      flashToast(`+${points}`)
      playRoundWin(score)
      if (currentTargetCountry) globeRef.value?.addFoundMarker(currentTargetCountry.lat, currentTargetCountry.lon, 0x4ade80)
    },
    onSkip: () => {
      hud.lastOutcome = 'skip'
      playSound('skip')
      if (currentTargetCountry) globeRef.value?.addFoundMarker(currentTargetCountry.lat, currentTargetCountry.lon, 0xf26d6d)
    },
    onTick: ({ remainingMs, score }) => {
      hud.score = score
      hud.remainingMs = remainingMs
      hud.remainingSeconds = Math.ceil(remainingMs / 1000)
      globeRef.value?.setCountdownProgress(remainingMs / GAME_DURATION_MS)
    },
    onEnd: (summary) => endGame(summary),
  })
  session.start()

  const loop = () => {
    if (!session || session.ended) return
    const now = performance.now()
    if (now - lastPollT > 90) {
      lastPollT = now
      session.tick(globeRef.value?.getFacingLatLon())
    }
    rafHandle = window.requestAnimationFrame(loop)
  }
  rafHandle = window.requestAnimationFrame(loop)
}

function flashToast (text) {
  hud.toast.text = text
  hud.toast.visible = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    hud.toast.visible = false
  }, 650)
}

function handleSkip () {
  if (session && !session.ended) session.skip()
}

// Keybind for skip (Space) — documented in README.md for contributors/power users,
// not in-game, since most players are on touch and never see a keyboard hint.
function handleGlobalKeydown (e) {
  if (e.code !== 'Space' || screen.value !== 'game') return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  e.preventDefault()
  handleSkip()
}
useEventListener(window, 'keydown', handleGlobalKeydown)

const resultsSummary = ref(null)
const submitStatus = ref('idle')

// The leaderboard shown in-place on the results screen once a score is submitted (see
// ResultsScreen.vue) — separate from the standalone Rankings screen's state below, since
// both can end up populated independently in the same session.
const postSubmitRows = ref([])
const postSubmitStatus = ref('idle') // idle | loading | ready | empty | error
const isHighScore = ref(false)
const youEntryId = ref(null)
const youRank = ref(null)

function endGame (summary) {
  if (rafHandle) window.cancelAnimationFrame(rafHandle)
  globeRef.value?.setMode({ interactive: false, autoRotateRpm: 1 })
  globeRef.value?.setCountdownProgress(1)
  playSound('end')

  // Personal-best tracking is local-only and doesn't need a submission — it's a running
  // tally of this device's own games. Only worth announcing once there's a little
  // history to compare against (see MIN_GAMES_FOR_PERSONAL_BEST).
  const prevBest = bestScoreLocal.value
  gamesPlayed.value += 1
  isPersonalBest.value = gamesPlayed.value >= MIN_GAMES_FOR_PERSONAL_BEST && summary.score > 0 && summary.score > prevBest
  if (summary.score > bestScoreLocal.value) bestScoreLocal.value = summary.score

  resultsSummary.value = summary
  submitStatus.value = 'idle'
  postSubmitRows.value = []
  postSubmitStatus.value = 'idle'
  isHighScore.value = false
  youEntryId.value = null
  youRank.value = null
  screen.value = 'results'
}

async function handleSubmitScore (name) {
  if (!resultsSummary.value) return
  submitStatus.value = 'pending'
  try {
    const score = resultsSummary.value.score
    const entryId = await submitScore({
      name,
      score,
      gameId: resultsSummary.value.gameId,
    })
    youEntryId.value = entryId
    saveLastSubmission({ entryId, name, score })
    await loadPostSubmitBoard(entryId, score)
    submitStatus.value = 'success'
  } catch (err) {
    console.error('[PuxiAche] submitScore failed', err)
    submitStatus.value = 'error'
  }
}

/** After a successful submit: fetch the top 20 and work out whether the fresh entry
 * landed at #1 (the "high score" animation trigger) and, either way, its rank. */
async function loadPostSubmitBoard (entryId, score) {
  postSubmitStatus.value = 'loading'
  try {
    const rows = await fetchTopScores(20)
    postSubmitRows.value = rows
    isHighScore.value = rows.length > 0 && rows[0].id === entryId
    const idx = rows.findIndex((r) => r.id === entryId)
    youRank.value = idx !== -1 ? idx + 1 : await fetchScoreRank(score)
    postSubmitStatus.value = rows.length === 0 ? 'empty' : 'ready'
  } catch (err) {
    console.error('[PuxiAche] post-submit leaderboard fetch failed', err)
    postSubmitStatus.value = 'error'
  }
}

// ---------- Leaderboard (standalone "Rankings" screen) ----------
const leaderboardRows = ref([])
const leaderboardStatus = ref('loading')
const leaderboardYouEntryId = ref(null)
const leaderboardYouRank = ref(null)
const leaderboardYouName = ref(null)
const leaderboardYouScore = ref(null)

async function openLeaderboard () {
  screen.value = 'leaderboard'
  leaderboardStatus.value = 'loading'
  leaderboardYouEntryId.value = null
  leaderboardYouRank.value = null
  leaderboardYouName.value = null
  leaderboardYouScore.value = null
  try {
    const rows = await fetchTopScores(20)
    leaderboardRows.value = rows

    // Show "you" on the general rankings too, using whatever was last submitted from
    // this device/browser — not just right after a fresh game.
    const last = loadLastSubmission()
    if (last) {
      leaderboardYouEntryId.value = last.entryId
      leaderboardYouName.value = last.name
      leaderboardYouScore.value = last.score
      const idx = rows.findIndex((r) => r.id === last.entryId)
      leaderboardYouRank.value = idx !== -1 ? idx + 1 : await fetchScoreRank(last.score)
    }

    leaderboardStatus.value = rows.length === 0 ? 'empty' : 'ready'
  } catch (err) {
    console.error('[PuxiAche] fetchTopScores failed', err)
    leaderboardStatus.value = 'error'
  }
}

// ---------- Boot ----------
onMounted(() => {
  initFirebase()
})
</script>
