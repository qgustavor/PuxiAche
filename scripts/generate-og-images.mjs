import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { render } from 'takumi-js'
import { SUPPORTED_LANGS } from './site-meta.mjs'

const root = resolve(import.meta.dirname, '..')
const publicDir = resolve(root, 'public')
const basePath = resolve(publicDir, 'og-base.png')
const WIDTH = 1280
const HEIGHT = 630

function escapeHtml (value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function loadTagline (lang) {
  const locale = JSON.parse(await readFile(resolve(root, 'src', 'locales', `${lang}.json`), 'utf8'))
  return locale.app.tagline
}

const basePng = await readFile(basePath)
const baseDataUrl = `data:image/jpeg;base64,${basePng.toString('base64')}`

for (const lang of SUPPORTED_LANGS) {
  const tagline = await loadTagline(lang)
  const fontSize = lang === 'en' ? 31 : lang === 'pt' ? 29 : 28
  const html = `
<div style="position:relative;width:100%;height:100%;overflow:hidden;background:#081526;">
  <img src="${baseDataUrl}" style="position:absolute;left:0;top:0;width:1280px;height:630px;" />
  <div style="position:absolute;left:0;top:338px;width:1280px;height:105px;display:flex;align-items:center;justify-content:center;padding:0 26px;box-sizing:border-box;text-align:center;color:#d8e0ed;font-family:sans-serif;font-size:${fontSize}px;font-weight:500;letter-spacing:0.2px;line-height:1.2;">
    ${escapeHtml(tagline)}
  </div>
</div>`

  const jpgPath = await render(html, { width: WIDTH, height: HEIGHT, format: "jpeg", quality: 80 })
  await writeFile(resolve(publicDir, `og-${lang}.jpg`), jpgPath)
  console.log(`Generated public/og-${lang}.jpg`)
}
