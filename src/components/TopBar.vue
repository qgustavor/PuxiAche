<template>
  <header id="top-bar">
    <button
      class="icon-btn"
      type="button"
      :aria-label="$t('menu.info')"
      @click="$emit('open-info')"
    >
      <Info :size="20" aria-hidden="true" />
    </button>
    <button
      class="icon-btn"
      type="button"
      :aria-label="$t('menu.theme')"
      @click="$emit('toggle-theme')"
    >
      <Moon v-if="theme === 'dark'" :size="20" aria-hidden="true" />
      <Sun v-else :size="20" aria-hidden="true" />
    </button>
    <button
      class="icon-btn"
      type="button"
      :aria-label="$t('menu.sound')"
      @click="$emit('toggle-sound')"
    >
      <Volume2 v-if="soundEnabled" :size="20" aria-hidden="true" />
      <VolumeX v-else :size="20" aria-hidden="true" />
    </button>
    <div class="lang-switch">
      <button
        v-for="lang in langs"
        :key="lang"
        type="button"
        class="lang-btn"
        :class="{ active: locale === lang }"
        @click="setLang(lang)"
      >
        {{ lang.toUpperCase() }}
      </button>
    </div>
  </header>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { Info, Moon, Sun, Volume2, VolumeX } from 'lucide-vue-next'
import { setLang, SUPPORTED_LANGS } from '../i18n.js'

defineProps({
  theme: { type: String, required: true },
  soundEnabled: { type: Boolean, default: false },
})
defineEmits(['toggle-theme', 'toggle-sound', 'open-info'])

const { locale } = useI18n()
const langs = SUPPORTED_LANGS
</script>
