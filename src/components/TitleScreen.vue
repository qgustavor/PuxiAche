<template>
  <section class="screen">
    <div class="title-card">
      <h1
        class="game-title"
        aria-label="PuxiAche"
      >
        <span
          v-for="(char, i) in titleChars"
          :key="i"
          class="title-char"
          :class="i < puxiLength ? 'title-char--puxi' : 'title-char--ache'"
          :style="{ '--i': i }"
        >{{ char }}</span>
      </h1>
      <p class="tagline">
        {{ $t('app.tagline') }}
      </p>
      <div class="title-actions">
        <button
          class="btn btn-primary"
          type="button"
          @click="$emit('play')"
        >
          {{ $t('menu.play') }}
        </button>
        <button
          class="btn btn-secondary"
          type="button"
          @click="$emit('rankings')"
          :disabled="!isOnline"
        >
          {{ $t('menu.rankings') }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { useOnline } from '@vueuse/core'

const isOnline = useOnline()

defineEmits(['play', 'rankings'])

// "PuxiAche" is a portmanteau of "Puxe" (pull/drag) and "Ache" (find) — each half gets its
// own color (see .title-char--puxi / .title-char--ache in style.css) so the wordplay reads
// visually, not just in the name itself.
const PUXI = 'Puxi'
const ACHE = 'Ache'
const puxiLength = PUXI.length
const titleChars = (PUXI + ACHE).split('')
</script>
