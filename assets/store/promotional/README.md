# Promotional Assets

AMO and the broader Firefox add-on ecosystem accept a few additional
promotional images. None are strictly required to publish, but together
they materially improve the listing's appearance in featured collections.

## Required for "featured" eligibility

- **Hero / promotional tile** — 1400 × 560 PNG/JPG.
  Filename: `hero-1400x560.png`.
  Should clearly show the sidebar in action against a recognizable Firefox
  chrome. Title overlay optional; if used, keep it left-aligned and small
  enough that AMO's own title text remains primary.

- **Social-preview image** — 1280 × 640 PNG/JPG.
  Filename: `social-preview-1280x640.png`.
  Used by GitHub's repository social preview (Settings → General → Social
  preview). The same image works on Twitter / X / Bluesky link cards.

## Optional / nice-to-have

- **Icon poster** — 1024 × 1024 PNG of the extension icon with margin,
  used for press kits.
  Filename: `icon-poster-1024x1024.png`.

- **Animated demo** — 1280 × 720 GIF or WebM, ≤ 8 MB, showing the agent
  completing a one-shot task end-to-end. Looped, no audio.
  Filename: `demo-1280x720.webm` (and matching `.gif` for fallback).

## Design notes

- Stay consistent with the in-extension theme: `--accent` cyan
  `#0891b2` against the dark `--bg-primary` `#0c0f14`.
- Use the project icon set as the brand mark; do not introduce a
  separate wordmark.
- Avoid any depiction of provider logos (Anthropic, OpenAI, Google,
  Ollama) without explicit permission. Use generic "Bring Your Own Key"
  language instead.

## Production checklist

- [ ] Hero exported at exact 1400 × 560 (AMO rejects misaligned aspect).
- [ ] Hero file ≤ 2 MB.
- [ ] Social preview exported at exact 1280 × 640.
- [ ] Filenames match the convention above.
- [ ] No screenshots contain real API keys or personal data.
- [ ] License: assets in this directory are CC0 / public domain so
      downstream forks may reuse them. Mark in metadata.
