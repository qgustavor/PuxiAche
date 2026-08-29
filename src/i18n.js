import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import pt from './locales/pt.json'
import es from './locales/es.json'

export const SUPPORTED_LANGS = ['en', 'pt', 'es']
const HTML_LANGS = { en: 'en', pt: 'pt-BR', es: 'es' }
const STORAGE_KEY = 'gd_lang'
const LOCALE_PATH_RE = new RegExp(`/(?:${SUPPORTED_LANGS.join('|')})(?:/index\\.html)?/?$`)

function detectBrowserLang () {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const l of langs) {
    if (!l) continue
    const short = l.slice(0, 2).toLowerCase()
    if (SUPPORTED_LANGS.includes(short)) return short
  }
  return 'en'
}

function detectPathLang () {
  const match = window.location.pathname.match(/\/(en|pt|es)(?:\/index\.html)?\/?$/)
  return match?.[1] || null
}

function detectInitialLang () {
  const pathLang = detectPathLang()
  if (pathLang) return pathLang

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && SUPPORTED_LANGS.includes(stored)) return stored
  } catch (e) { /* ignore */ }

  return detectBrowserLang()
}

function persistLang (lang) {
  try { localStorage.setItem(STORAGE_KEY, lang) } catch (e) { /* ignore */ }
}

function localizedUrl (lang) {
  const url = new URL(window.location.href)

  if (LOCALE_PATH_RE.test(url.pathname)) {
    url.pathname = url.pathname.replace(LOCALE_PATH_RE, `/${lang}/`)
  } else {
    url.pathname = `${url.pathname.replace(/\/?$/, '/')}${lang}/`
  }

  return url.href
}

const initialLang = detectInitialLang()
persistLang(initialLang)

export const i18n = createI18n({
  legacy: false,
  locale: initialLang,
  fallbackLocale: 'en',
  messages: { en, pt, es },
})

/** Change language, persist the choice, and move to the matching localized URL. */
export function setLang (lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return

  persistLang(lang)

  if (detectPathLang() === lang) {
    i18n.global.locale.value = lang
    document.documentElement.setAttribute('lang', HTML_LANGS[lang])
    return
  }

  window.location.assign(localizedUrl(lang))
}

document.documentElement.setAttribute('lang', HTML_LANGS[initialLang])
