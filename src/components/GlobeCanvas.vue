<template>
  <div
    id="globe-container"
    ref="containerEl"
    aria-hidden="true"
  />
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { Globe } from '../globe.js'
import { COUNTRY_LIST } from '../data/countryData.js'

const props = defineProps({
  theme: { type: String, default: 'dark' },
})

const containerEl = ref(null)
let globe = null

onMounted(() => {
  globe = new Globe(containerEl.value, COUNTRY_LIST, props.theme)
  globe.setMode({ interactive: false, autoRotateRpm: 1 }) // idle title-screen spin
  globe.start()
})

useEventListener(window, 'orientationchange', () => {
  setTimeout(() => globe?.resize(), 200)
})

watch(() => props.theme, (theme) => {
  globe?.setTheme(theme)
})

onBeforeUnmount(() => {
  globe?.dispose()
})

/** Exposed imperative API used by the parent (App.vue) to drive gameplay. */
defineExpose({
  setMode: (opts) => globe?.setMode(opts),
  getFacingLatLon: () => globe?.getFacingLatLon(),
  addFoundMarker: (lat, lon, color) => globe?.addFoundMarker(lat, lon, color),
  setCountdownProgress: (fraction) => globe?.setCountdownProgress(fraction),
})
</script>
