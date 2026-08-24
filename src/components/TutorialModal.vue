<template>
  <div class="modal">
    <div class="modal-card tutorial-single">
      <button
        class="modal-close"
        type="button"
        :aria-label="$t('common.close')"
        @click="close"
      >
        <X :size="20" />
      </button>

      <h2>{{ $t('tutorial.title') }}</h2>

      <ul class="tutorial-body">
        <li
          v-for="(step, i) in $tm('tutorial.steps')"
          :key="i"
        >
          {{ step }}
        </li>
      </ul>

      <div class="tutorial-buttons">
        <button
          class="btn btn-primary"
          type="button"
          @click="start"
        >
          {{ $t('tutorial.start') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { X } from 'lucide-vue-next'

const emit = defineEmits(['start', 'close'])

function start () {
  emit('start')
}

function close () {
  emit('close')
}
</script>
