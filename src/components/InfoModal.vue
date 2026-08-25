<template>
  <div
    class="modal"
    @click.self="$emit('close')"
  >
    <div class="modal-card info-card">
      <h2>{{ $t('info.title') }}</h2>

      <section class="credits-section">
        <h3>{{ $t('info.madeBy') }}</h3>
        <ul class="credits-list">
          <li
            v-for="person in AUTHORS"
            :key="person.name"
          >
            <a
              v-if="person.url"
              :href="person.url"
              target="_blank"
              rel="noopener noreferrer"
            >{{ person.name }}</a>
            <span v-else>{{ person.name }}</span>
          </li>
        </ul>
      </section>

      <section
        v-if="COAUTHORS.length"
        class="credits-section"
      >
        <h3>{{ $t('info.coauthors') }}</h3>
        <ul class="credits-list">
          <li
            v-for="person in COAUTHORS"
            :key="person.name"
          >
            <a
              v-if="person.url"
              :href="person.url"
              target="_blank"
              rel="noopener noreferrer"
            >{{ person.name }}</a>
            <span v-else>{{ person.name }}</span>
          </li>
        </ul>
      </section>

      <section class="credits-section">
        <h3>{{ $t('info.builtWith') }}</h3>
        <ul class="credits-list">
          <li>{{ $t('info.aiCredit') }}</li>
        </ul>
      </section>

      <a
        class="repo-link"
        :href="REPO_URL"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ $t('info.repo') }}
      </a>

      <div class="tutorial-buttons">
        <button
          class="btn btn-secondary"
          type="button"
          @click="$emit('open-tutorial')"
        >
          {{ $t('info.reopenTutorial') }}
        </button>
        <button
          class="btn btn-primary"
          type="button"
          @click="$emit('close')"
        >
          {{ $t('info.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
const AUTHORS = [
  { name: 'Gustavo Rodrigues', url: 'https://github.com/qgustavor' },
]
const COAUTHORS = [
  { name: 'Professor Wagner', url: 'https://ursal.zone/@wag' },
  { name: 'GeoJogos', url: 'https://play.google.com/store/apps/details?id=br.com.geojogos' }
]
const REPO_URL = 'https://github.com/qgustavor/PuxiAche'

defineEmits(['close', 'open-tutorial'])
</script>
