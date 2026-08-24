<template>
  <section class="screen">
    <div class="leaderboard-card">
      <h2>{{ $t('leaderboard.title') }}</h2>
      <div id="leaderboard-body">
        <p v-if="status === 'loading'">
          {{ $t('leaderboard.loading') }}
        </p>
        <p v-else-if="status === 'error'">
          {{ $t('leaderboard.error') }}
        </p>
        <p v-else-if="status === 'empty'">
          {{ $t('leaderboard.empty') }}
        </p>
        <div v-else>
          <div
            v-for="(row, i) in rows"
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

          <!-- Player isn't in the visible rows above, but we know their rank — pin them
               at the bottom instead of leaving them wondering where they placed. -->
          <template v-if="youRank && !youInRows">
            <div
              class="lb-ellipsis"
              aria-hidden="true"
            >
              ···
            </div>
            <div class="lb-row lb-row-you">
              <span class="lb-rank">{{ youRank }}</span>
              <span class="lb-name">{{ youName }}<span class="lb-you-tag">{{ $t('leaderboard.you') }}</span></span>
              <span class="lb-score">{{ youScore }}</span>
            </div>
          </template>
        </div>
      </div>
      <button
        class="btn btn-secondary"
        type="button"
        @click="$emit('back')"
      >
        {{ $t('leaderboard.back') }}
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  status: { type: String, default: 'loading' }, // loading | ready | empty | error
  youEntryId: { type: String, default: null },
  youRank: { type: Number, default: null },
  youName: { type: String, default: null },
  youScore: { type: Number, default: null },
})
defineEmits(['back'])

const youInRows = computed(() => props.rows.some((r) => r.id === props.youEntryId))
</script>
