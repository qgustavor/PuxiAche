import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LOCALES, SITE_BASE_URL, SUPPORTED_LANGS } from './site-meta.mjs'

const root = resolve(import.meta.dirname, '..')
const twitterDomain = new URL(SITE_BASE_URL).hostname

function escapeHtml (value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function renderPage (lang) {
  const meta = LOCALES[lang]
  const pageUrl = new URL(`${lang}/`, SITE_BASE_URL).href
  const imageUrl = new URL(meta.image, SITE_BASE_URL).href
  const alternates = SUPPORTED_LANGS
    .filter((otherLang) => otherLang !== lang)
    .map((otherLang) => `  <meta property="og:locale:alternate" content="${LOCALES[otherLang].ogLocale}">`)
    .join('\n')
  const hreflang = SUPPORTED_LANGS
    .map((otherLang) => `  <link rel="alternate" hreflang="${otherLang}" href="${new URL(`${otherLang}/`, SITE_BASE_URL).href}">`)
    .join('\n')

  return `<!doctype html>
<html lang="${meta.htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <title>${escapeHtml(meta.title)}</title>
  <meta name="description" content="${escapeHtml(meta.description)}">
  <link rel="canonical" href="${pageUrl}">
${hreflang}
  <link rel="alternate" hreflang="x-default" href="${new URL('en/', SITE_BASE_URL).href}">
  <link rel="icon" href="../favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../src/style.css">
  <meta name="theme-color" content="#2fd6c0">

  <meta property="og:url" content="${pageUrl}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="${meta.ogLocale}">
${alternates}
  <meta property="og:title" content="${escapeHtml(meta.title)}">
  <meta property="og:description" content="${escapeHtml(meta.description)}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="PuxiAche">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:domain" content="${twitterDomain}">
  <meta name="twitter:url" content="${pageUrl}">
  <meta name="twitter:title" content="${escapeHtml(meta.title)}">
  <meta name="twitter:description" content="${escapeHtml(meta.description)}">
  <meta name="twitter:image" content="${imageUrl}">
  <meta name="twitter:image:alt" content="PuxiAche">
</head>
<body>
  <div id="app-root"></div>
  <script type="module" src="../src/main.js"></script>
</body>
</html>
`
}

for (const lang of SUPPORTED_LANGS) {
  const dir = resolve(root, lang)
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, 'index.html'), renderPage(lang))
  console.log(`Generated ${lang}/index.html`)
}
