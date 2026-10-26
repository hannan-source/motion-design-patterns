# Jitter Motion-Design Pattern Library

A distilled knowledge base of the recurring motion techniques behind all 408 templates
in Jitter's library (jitter.video/templates). Each pattern was reverse-engineered from
the template's own description of *what animates and how*, then translated into a
code-oriented recipe (GSAP / CSS / SVG / canvas) so an AI coding agent can recreate
premium motion graphics without watching the originals.

## How to use with an AI coding agent (Claude Code / Kimi Code)

1. Find the pattern you want in `templates-index.md` (full catalog, searchable by
   slug, title, category, or technique keyword).
2. Open the pattern file for that domain (below) and **attach it as context** to your
   coding session, e.g. "implement the *Stretch & Snap* pattern from
   patterns/text-animation.md for this headline".
3. Also attach `MOTION-PRINCIPLES.md` when starting a new scene — it carries the
   cross-cutting timing/easing/stagger rules that make the result feel "Jitter-grade"
   rather than default-linear.
4. Every pattern entry has: what animates → which CSS/SVG property → timing/easing
   feel → a concrete GSAP hint → exemplar template slugs for reference
   (view at `https://jitter.video/template/<slug>/`).

## Pattern files

| File | Domain | Contents |
|---|---|---|
| `patterns/text-animation.md` | Kinetic type | staggered reveals, stretch/snap, blur-in, scramble, glitch, trails, masks, inflating type, loops |
| `patterns/charts-and-data.md` | Data viz | growing bars, draw-on lines, ring sweeps, donut sequences, count-ups, radar morphs |
| `patterns/buttons-and-ui.md` | Micro-interactions | glow/press states, toggles, notifications, menus, loaders, badges, likes, search bars |
| `patterns/social-media.md` | Social formats | orbit/spiral/mirror showreels, stacked cards, story layouts, messaging, like pops |
| `patterns/camera-and-scene.md` | Scene language | zooms, push-ins, 3D rotations, parallax, mask/split/wipe/pixel transitions |
| `patterns/backgrounds-and-effects.md` | Atmosphere | gradients, grain, halftone, dither, CRT, glitch, gooey, blend modes, looping fields |
| `patterns/logos-and-branding.md` | Brand marks | logo reveals, blur switchers, icon morphs, color pops, app-icon bounces |
| `MOTION-PRINCIPLES.md` | Cross-cutting rules | easing families, stagger discipline, overshoot/settle, loop construction, rhythm, restraint |
| `templates-index.md` | Full catalog | all 408 templates: slug, title, categories, technique summary |

## Conventions

- GSAP hints assume GSAP 3 + SplitText (or manual `char` spans) where noted.
- "Spring/snappy" feel = `ease: "back.out(1.7)"` or custom spring; "smooth premium"
  feel = `expo.out` / `power3.out`.
- Durations are given as ranges observed across the catalog's described pacing.
- Template slugs cited as `see: slug-a, slug-b` resolve to
  `https://jitter.video/template/<slug>/`.
