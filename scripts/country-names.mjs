// Generates translated country names using Intl.DisplayNames, which ships with the JS
// runtime and covers virtually every language this project might add (see CONTRIBUTING.md).
// Takes ISO alpha-2 codes, the convention used everywhere else in this project.
//
// Its output is sometimes more formal/verbose than what reads well in a quick geography
// game (e.g. "Congo - Kinshasa" instead of "DR Congo") — COUNTRY_NAME_OVERRIDES patches
// just those cases.
import { COUNTRY_NAME_OVERRIDES } from './country-name-overrides.mjs'

const displayNamesCache = new Map() // locale -> Intl.DisplayNames

function getDisplayNames (locale) {
  let dn = displayNamesCache.get(locale)
  if (!dn) {
    dn = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' })
    displayNamesCache.set(locale, dn)
  }
  return dn
}

/**
 * Returns { [locale]: name } for a country, for each locale in `locales`.
 * @param {string} alpha2 - ISO 3166-1 alpha-2 code, e.g. 'PT'.
 * @param {string} fallbackName - used for any locale we can't resolve a translation for.
 */
export function getCountryNames (alpha2, fallbackName, locales) {
  const names = {}
  for (const locale of locales) {
    const override = COUNTRY_NAME_OVERRIDES[alpha2]?.[locale]
    if (override) {
      names[locale] = override
      continue
    }
    let resolved = null
    try {
      resolved = getDisplayNames(locale).of(alpha2)
    } catch { /* unsupported/synthetic code */ }
    names[locale] = resolved || fallbackName
  }
  return names
}
