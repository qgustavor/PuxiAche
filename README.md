# PuxiAche

A spin-the-globe geography game! Spin a 3D globe and find as many countries as you can before time runs out.

## How to play

1. Press **Play**.
2. You'll be given a country to find — drag the globe to bring it under the reticle in the center of the screen.
3. Small countries (marked ★) are worth more points than large ones.
4. Can't find it? Skip it and move on to the next one.
5. You've got 60 seconds. Beat your best score, then check the rankings.

## Controls

- **Touch/mouse:** drag to rotate the globe.
- **Keyboard:** arrow keys rotate, space skips.

## Contributing

Want to help build or translate the game? See [CONTRIBUTING.md](./CONTRIBUTING.md) for the stack, project layout, and translation instructions.

## Localized URLs and social previews

The public entry points are `/en/`, `/pt/`, and `/es/`. Visiting `/` redirects to the saved language when available, otherwise the browser language, with English as the fallback.

Run `bun run generate:pages` to refresh the localized HTML metadata and `bun run generate:og` to rebuild `public/og-en.png`, `public/og-pt.png`, and `public/og-es.png`. The OG generator uses Takumi and the existing globe/logo preview as a shared base, then renders only the translated tagline for each locale.
