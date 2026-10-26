# Text Animation Patterns

Derived from Jitter's `text` + `video-titles` categories (≈90 templates).

## 1. Staggered line cascade
Lines of text fall/rise into place one after another, each landing separately.
- **Recipe:** per-line `y` offset (40–100%) → 0, slight `rotate` optional, stagger top-down.
- **Feel:** smooth power-out; each line fully lands before the next is 50% in.
- **GSAP:** `gsap.from('.line', {yPercent: 110, stagger: 0.12, duration: 0.8, ease: 'expo.out'})`
- See: cascading-text, animated-feature-list, the-harvest-pulp, gradients-animated-list.

## 2. Stretch & snap
Type scales wider/taller past its target, then snaps back to rest — the catalog's
signature "physical" text move.
- **Recipe:** `scaleX`/`scaleY` overshoot (1.2–1.4) → 1 with elastic settle; sometimes
  combined with skew. Words can enter already stretched.
- **Feel:** springy, elastic, punchy.
- **GSAP:** `gsap.from('.word', {scaleX: 1.35, scaleY: 0.8, duration: 0.9, ease: 'elastic.out(1, 0.45)', stagger: 0.06})`
- See: stretch-snap-text, elastic-text, stretch, squeeze, bouncy-period.

## 3. Tilted snap-in
Each headline line rotates in at a slight tilt (5–12°) and settles upright; stacked
lines can *collide* and settle against each other.
- **Recipe:** per-line `rotation: 6→0` + `yPercent: 100→0`, transform-origin bottom-left.
- **Feel:** snappy expo-out with a hard settle.
- **GSAP:** `gsap.from('.line', {rotation: 8, yPercent: 110, transformOrigin: '0 100%', ease: 'back.out(2)', stagger: 0.1})`
- See: tilted-text-snap, bold-text-snap, wow-rotate-and-scale.

## 4. Blur-in focus pull
Text sharpens from a soft blur as it lands — reads as a camera finding focus.
- **Recipe:** `filter: blur(12–20px)` → 0 + slight scale 1.05→1 or y drift.
- **Feel:** smooth expo-out, 0.6–0.9s; confident and clean.
- **GSAP:** `gsap.fromTo(el, {filter:'blur(16px)', opacity:0, scale:1.04}, {filter:'blur(0px)', opacity:1, scale:1, duration:0.8, ease:'expo.out'})`
- See: motion-blur-text, blur-counter, blurry-text-spin (blur + rotation variant).

## 5. Motion-blur scroller / type trail
Words scroll fast with a directional blur or leave a fading ghost trail — conveys speed.
- **Recipe:** rapid `y`/`x` translation + directional `blur`; trail = cloned layers at
  decreasing opacity/delay behind the lead layer.
- **Feel:** fast linear/power movement; blur proportional to velocity.
- **GSAP:** tween `y` with `ease:'none'`, map velocity→`filter:blur(v*0.4px)`; trail via 3 clones with `delay: 0.03*i, opacity: 0.5/i`.
- See: type-trail, blur-text-scroller.

## 6. Scramble / decode
Characters cycle through random glyphs before resolving to the final text.
- **Recipe:** per-char interval replacing chars from a glyph pool, resolving left→right.
- **Feel:** mechanical tick (~30–50ms/char step), then hard resolve.
- **GSAP:** custom plugin or `gsap.to({}, {duration:1.2, onUpdate})` stepping a scramble fn; or ScrambleTextPlugin.
- See: text-scramble, clock-counter (flickering timer variant).

## 7. Glitch reveal
Text tears with RGB-split offsets, slice displacements and jitter before stabilizing.
- **Recipe:** duplicate text layers (R/B channel tinted), random `clip-path: inset()`
  slices + `x` jitter on a stepped timeline; ends clean.
- **Feel:** stepped/erratic, 4–8 glitch bursts over ~0.6s.
- **GSAP:** `gsap.timeline({repeat:3}).set(layer,{clipPath:randSlice, x:gsap.utils.random(-8,8)})` on 2 pseudo-layers.
- See: glitch-01-text-reveal, glitch-02-text-reveal, glitchy-text-reveal.

## 8. Masked slide reveal
Words slide up from behind an overflow mask (line boxes act as windows).
- **Recipe:** wrapper `overflow:hidden`; inner `yPercent: 110→0`, stagger per line.
- **Feel:** deliberate, editorial; expo-out.
- **GSAP:** SplitText lines → `gsap.from(lines, {yPercent:110, duration:0.9, ease:'expo.out', stagger:0.09})`
- See: sliding-text-reveal, sliding-title-reveal-apple-event, video-title-slide, save-the-date.

## 9. Morph-to-text (dots / lines / shapes)
Particles, lines or an abstract shape rearrange and *resolve* into readable type.
- **Recipe:** precompute target char positions; tween each particle `x/y` to its target
  with stagger; shapes use `attr:{d: ...}` path morph.
- **Feel:** organic gather, power2.in-out, 1–1.5s.
- **GSAP:** `gsap.to('.dot', {x:i=>tx[i], y:i=>ty[i], stagger:{each:0.004, from:'random'}, ease:'power3.inOut'})`
- See: morph-dots-to-text, morph-lines-to-text, morph-shape-to-text.

## 10. Inflating / swelling type
Letters swell like soft rubber — scale from inside with a pillowy morph.
- **Recipe:** per-char `scale` 0.6→1 with strong elastic ease; optionally animate
  `font-variation-settings` weight/width for a true inflate.
- **Feel:** soft elastic, playful.
- **GSAP:** `gsap.from(chars, {scale:0.4, ease:'elastic.out(1.1,0.4)', stagger:{each:0.03, from:'center'}})` or variable-font `'wght' 100→900` tween.
- See: morph-inflating-text, zero-gravity-bouncy-words.

## 11. Looped marquee text
Text scrolls continuously with no visible seam.
- **Recipe:** duplicate content ×2, translate −50%, `repeat:-1, ease:'none'`; width must
  be an exact multiple of content width.
- **Feel:** constant linear speed.
- **GSAP:** `gsap.to(track, {xPercent:-50, duration:8, ease:'none', repeat:-1})`
- See: motion-design-looped-text.

## 12. Stretched type repeater
One word stretched and duplicated into a rhythmic stack/band — type as pattern.
- **Recipe:** fixed-height repeated lines, alternate `scaleY`/`scaleX` pulses with
  stagger; or scroll the stack in a loop.
- **Feel:** metronomic, rhythmic.
- **GSAP:** `gsap.to('.rep', {scaleY:1.3, yoyo:true, repeat:-1, stagger:{each:0.08, from:'center'}})`
- See: stretched-type-repeater, animated-repeater.

## 13. 3D extrusion / mirror type
Type gets depth (stacked offset layers) or is mirrored into a symmetrical composition.
- **Recipe:** extrusion = N clipped copies offset in `y`/`x` behind face, animate offsets;
  mirror = flipped duplicate with gradient fade, sync both animations.
- **Feel:** slow, graphic, title-card weight.
- **GSAP:** `gsap.from('.ext-layer', {y:i=>i*2, stagger:0.02})`; mirror via `scaleY:-1` + mask-image.
- See: text-extrusion, text-mirror-effect.

## 14. Weightless word physics
Words float, drift and bounce as if in zero gravity.
- **Recipe:** per-word slow `y` sine drift + rotation, occasional bounce impulse;
  independent phases.
- **Feel:** floaty springs, low stiffness.
- **GSAP:** loop `gsap.to(word, {y:'+=14', rotation:2, yoyo:true, repeat:-1, duration:1.6+i*0.2, ease:'sine.inOut'})`
- See: zero-gravity-bouncy-words, the-harvest-orange-float, the-harvest-banana-spin.

## 15. Quiet appear
Minimal entrance: opacity + tiny y. Used where motion must not steal focus.
- **Recipe:** `opacity 0→1, y 8→0`, 0.4s.
- **GSAP:** `gsap.from(el, {opacity:0, y:8, duration:0.4, ease:'power2.out'})`
- See: appear, glide, simple-dot-logo (same restraint in logo form).

## 16. Big-number countdown
Oversized numerals swap/tick as the countdown progresses.
- **Recipe:** snap whole-number textContent tween; scale-pulse each tick.
- **GSAP:** `gsap.to(obj,{val:0,duration:3,snap:{val:1},ease:'none',onUpdate})` + `scale:1.1→1` per tick.
- See: countdown-bold, the-track-countdown, counter-poster.

## 17. Flip-board (split-flap) text
Airport-board style: characters flip down like mechanical tiles.
- **Recipe:** per-char 3D `rotationX: -90→0` with top-half/bottom-half split illusion;
  random resolve order.
- **GSAP:** `gsap.from(chars, {rotationX:-90, transformOrigin:'50% 50% -10px', stagger:{each:0.05, from:'random'}})`
- See: the-route-departures-board.
