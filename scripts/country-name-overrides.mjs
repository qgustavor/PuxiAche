// Intl.DisplayNames is right almost everywhere, but a handful of its names are more
// formal/verbose than what reads well in a quick geography game. Keyed by ISO 3166-1
// alpha-2 code -> locale -> name. Add an entry here (rather than editing
// scripts/country-names.mjs) whenever a newly-added locale needs the same treatment.
export const COUNTRY_NAME_OVERRIDES = {
  CD: { pt: 'República Democrática do Congo', es: 'República Democrática del Congo' }, // ICU pt: "Congo - Kinshasa"
  MM: { pt: 'Mianmar', es: 'Myanmar' }, // ICU: "Mianmar (Birmânia)" / "Myanmar (Birmania)"
  HK: { pt: 'Hong Kong', es: 'Hong Kong' }, // ICU: "Hong Kong, RAE da China" / "RAE de Hong Kong (China)"
  MO: { pt: 'Macau', es: 'Macao' }, // ICU: "Macau, RAE da China" / "RAE de Macao (China)"
  PS: { pt: 'Palestina', es: 'Palestina' }, // Node.js and Bun ISO 3166 data is out-of-date
}
