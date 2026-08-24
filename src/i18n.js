import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import pt from './locales/pt.json'
import es from './locales/es.json'

export const SUPPORTED_LANGS = ['en', 'pt', 'es']
const STORAGE_KEY = 'gd_lang'

function detectBrowserLang () {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const l of langs) {
    if (!l) continue
    const short = l.slice(0, 2).toLowerCase()
    if (SUPPORTED_LANGS.includes(short)) return short
  }
  return 'en' // default per spec
}

function detectInitialLang () {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && SUPPORTED_LANGS.includes(stored)) return stored
  } catch (e) { /* ignore */ }
  return detectBrowserLang()
}

export const i18n = createI18n({
  legacy: false, // enables the Composition API (useI18n) everywhere
  locale: detectInitialLang(),
  fallbackLocale: 'en',
  messages: { en, pt, es },
})

/** Change language and persist the choice; call this instead of touching i18n.global.locale directly. */
export function setLang (lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return
  i18n.global.locale.value = lang
  try { localStorage.setItem(STORAGE_KEY, lang) } catch (e) { /* ignore */ }
  document.documentElement.setAttribute('lang', lang)
}

document.documentElement.setAttribute('lang', i18n.global.locale.value)
