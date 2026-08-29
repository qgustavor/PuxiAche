#!/usr/bin/env bun
/**
 * Generate language-specific index.html files for /en/, /pt/, /es/ paths.
 * Each file has its own OpenGraph metadata for social sharing.
 * 
 * Run: bun scripts/generate-locales.mjs <dist-dir>
 * This is automatically called during build (see vite.config.js)
 */

import fs from 'fs'
import path from 'path'

const LOCALES = {
  en: {
    lang: 'en',
    title: 'PuxiAche — race to find countries before time runs out!',
    description: 'You have just ONE minute, spin the globe and race to find countries before time runs out, competing against other users in a leaderboard. Think fast!',
    image: './preview.jpg',
  },
  pt: {
    lang: 'pt',
    title: 'PuxiAche — corra para encontrar países antes do tempo acabar!',
    description: 'Você tem apenas UM MINUTO, gire o globo e corra para encontrar países antes do tempo acabar, competindo contra outros usuários em um ranking. Pense rápido!',
    image: './preview.jpg',
  },
  es: {
    lang: 'es',
    title: 'PuxiAche — ¡corre para encontrar países antes de que se acabe el tiempo!',
    description: 'Tienes solo UN MINUTO, gira el globo y corre para encontrar países antes de que se acabe el tiempo, compitiendo contra otros usuarios en una tabla de clasificación. ¡Piensa rápido!',
    image: './preview.jpg',
  },
}

/**
 * Generate OpenGraph meta tags for a given locale
 */
function generateOGTags (locale, baseUrl) {
  const og = LOCALES[locale]
  const url = `${baseUrl}${locale}/`
  
  return `
  <meta property="og:url" content="${url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${og.title}">
  <meta property="og:description" content="${og.description}">
  <meta property="og:image" content="${baseUrl}${og.image}">
  <meta property="og:locale" content="${og.lang}${og.lang === 'pt' ? '_BR' : og.lang === 'es' ? '_ES' : '_US'}">
  
  <meta name="twitter:card" content="summary_large_image">
  <meta property="twitter:domain" content="qgustavor.github.io">
  <meta property="twitter:url" content="${url}">
  <meta name="twitter:title" content="${og.title}">
  <meta name="twitter:description" content="${og.description}">
  <meta name="twitter:image" content="${baseUrl}${og.image}">`
}

/**
 * Generate a localized index.html by replacing the meta tags in the original
 */
function generateLocalizedHTML (templatePath, locale, baseUrl) {
  let html = fs.readFileSync(templatePath, 'utf-8')
  
  // Find and replace the og: and twitter: meta tags section
  const ogTagsRegex = /<meta property="og:url"[\s\S]*?<meta name="twitter:image"[^>]*>/
  const newOGTags = generateOGTags(locale, baseUrl)
  
  html = html.replace(ogTagsRegex, newOGTags)
  
  // Update html lang attribute
  html = html.replace(/<html[^>]*lang="[^"]*"/, `<html lang="${LOCALES[locale].lang}"`)
  
  // Update meta description
  html = html.replace(
    /<meta name="description" content="[^"]*"/,
    `<meta name="description" content="${LOCALES[locale].description}"`
  )
  
  return html
}

/**
 * Main: generate locale-specific HTML files in the dist directory
 */
async function main () {
  const distDir = process.argv[2]
  if (!distDir) {
    console.error('Usage: bun scripts/generate-locales.mjs <dist-dir>')
    process.exit(1)
  }

  const indexPath = path.join(distDir, 'index.html')
  if (!fs.existsSync(indexPath)) {
    console.error(`index.html not found at ${indexPath}`)
    process.exit(1)
  }

  // GitHub Pages URL base (adjust if deploying elsewhere)
  // This ensures OpenGraph URLs are absolute and correct
  const baseUrl = 'https://qgustavor.github.io/PuxiAche/'

  // Create language directories and generate index.html for each
  for (const locale of Object.keys(LOCALES)) {
    const localeDir = path.join(distDir, locale)
    fs.mkdirSync(localeDir, { recursive: true })

    const localizedHTML = generateLocalizedHTML(indexPath, locale, baseUrl)
    const localizedIndexPath = path.join(localeDir, 'index.html')
    fs.writeFileSync(localizedIndexPath, localizedHTML, 'utf-8')

    console.log(`✓ Generated ${locale}/ with localized OpenGraph tags`)
  }

  console.log(`\n✓ Locale HTML files generated successfully`)
  console.log(`  Users can now visit:`)
  console.log(`  - ${baseUrl}en/`)
  console.log(`  - ${baseUrl}pt/`)
  console.log(`  - ${baseUrl}es/`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
