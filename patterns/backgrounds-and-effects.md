# Backgrounds & Effects Patterns

Derived from `backgrounds` (26) plus the `blend-modes-*`, `gradients-*` and effect
templates scattered through the catalog. All are loop-first constructions.

## 1. Gradient color cycle
Slow continuous hue/color transitions — the default premium backdrop.
- **Recipe:** large radial/linear gradients animating `background-position` or hue;
  6–12s per cycle, ease none, repeat.
- **CSS:** `@keyframes {to{background-position:200% 0}}` on a 200%-wide gradient; or GSAP `gsap.to(el,{'--hue':360,repeat:-1,duration:10,ease:'none'})`.
- See: gradient-background, procedural-gradient-background, gradients-haze (slower, hazier).

## 2. Directional gradient sweeps
A gradient band sweeps diagonally/vertically across the frame in a loop.
- **Recipe:** oversized gradient layer translated across, `ease:'none', repeat:-1`;
  4–8s.
- See: gradients-diagonal-sweep, gradients-vertical-sweep, highlight-effect (light-sweep over content, same mechanic on a sheen layer).

## 3. Morphing gradient shapes / petals
Gradient-filled blobs drift, blend and morph between forms.
- **Recipe:** 2–4 absolutely-positioned blurred radial blobs; independent `x/y/scale`
  sine loops with different periods (non-integer ratios avoid visible repetition);
  `border-radius` morph for shape change.
- **GSAP:** blobs on `yoyo` sine.inOut tweens, durations 5/7/11s.
- See: gradients-morphing-shapes, gradients-geometric-morph, gradients-petals, gradients-bento (per-cell variants), gradients-animated-list (per-row variants).

## 4. Kaleidoscope
Rotating symmetric gradient patterns; also used as an intro that "unfolds".
- **Recipe:** one wedge rotated N×(360/n) copies inside overflow-hidden circle;
  animate rotation + hue; intro = scale from 0 with rotation.
- See: gradients-kaleidoscope, kaleidoscope-intro-slide.

## 5. Perspective tunnel
Concentric gradient frames receding to a vanishing point — travel-through-color loop.
- **Recipe:** rings scaling 0.2→1.4 from center, staggered spawn, fade at edges; repeat.
- **GSAP:** `gsap.fromTo(ring,{scale:.2,opacity:1},{scale:1.5,opacity:0,duration:3,repeat:-1,stagger:.5})`
- See: gradients-perspective-tunnel, inward-echo-loop (repeating shapes echoing inward).

## 6. Grain, noise & dithering
Animated noise textures: film grain over gradients, retro dither patterns.
- **Recipe:** SVG `feTurbulence` overlay (animate `seed`/`baseFrequency` via steps for
  shimmer) or a tiling noise PNG with stepped `background-position`; dithering =
  canvas Bayer-map threshold per frame.
- See: gradient-noisy-blur, grainy-color-clamp (grain + palette clamp), dithering-effect, luma-dot-background (dots sized by image luminance — canvas sampling).

## 7. Halftone & threshold
Print-style dot patterns and high-contrast monochrome conversions, animated.
- **Recipe:** halftone = radial-gradient dot tiling whose size tracks brightness (canvas
  or CSS mask + scale pulse); threshold = CSS `filter: contrast()` + `grayscale()` or
  SVG feComponentTransfer discrete table; animate the cutoff.
- See: halftone-effect, threshold-effect, counter-pixel, halftone-counter-poster.

## 8. CRT / retro screen
Scanlines, noise, flicker — vintage monitor look.
- **Recipe:** repeating-linear-gradient scanline overlay + noise layer + occasional
  `y` jitter/`brightness` flicker on a stepped timeline; subtle RGB split optional.
- See: crt-effect, rewind (VHS rewind), clock-counter (glitch timer).

## 9. Blend-mode compositions
Elements layered with CSS `mix-blend-mode` for double exposure, color interaction,
type-over-image print effects.
- **Recipe:** `mix-blend-mode: multiply/overlay/screen/difference` on stacked layers;
  animate the layers (scale/x/rotation) — the blend does the visual work.
  Double exposure = image + texture at `screen`/`lighten` with slow scale drift.
- See: blend-modes-double-exposure, blend-modes-color-blocks, blend-modes-circle-stack, blend-modes-gradient-orbs, blend-modes-collage-shuffle, blend-modes-overlay-poster, blend-modes-type-blend, blend-modes-color-and-text, blend-modes-mode-showcase, multiply.

## 10. Gooey liquid
Shapes merge and split like liquid.
- **Recipe:** SVG filter `feGaussianBlur` + `feColorMatrix` alpha contrast (the classic
  goo filter) on moving circles; animate circle positions.
- **CSS/SVG:** `filter:url(#goo)` where `#goo = blur(10) + alpha matrix(19,-9)`.
- See: gooey-effect, smile (fluid abstract composition), morph-animated-face.

## 11. Blur fields & bubbles
Soft blurred orbs floating in a looping composition; foreground content stays sharp.
- **Recipe:** large-radius `filter:blur(30-60px)` colored divs on slow sine drift loops;
  layer behind content; carousel variant pairs blur bg with sharp sliding cards.
- See: blur-bubbles, blur-bubbles-carousel, blur-article-gallery-ios, blur-news-stack-ios.

## 12. Glass refraction
Ribbed/fluted glass distorts what's behind it.
- **Recipe:** repeating-linear-gradient highlights + `backdrop-filter: blur()` with a
  displacement map (SVG feDisplacementMap) for true ribbing; animate the map offset.
- See: fluted-glass-background-ios, frosted-glass-counter, glass-button.

## 13. Looping pattern fields
Lines, stripes, chevrons, dots, waves, rotating shapes — continuous directional loops.
- **Recipe:** tile a pattern ×2 along motion axis, translate −50%, `repeat:-1, ease:'none'`;
  waves = sine path on SVG `d` or stacked `border-radius` blobs translating;
  rotating shapes = uniform `rotation` loop with per-item phase offset.
- See: moving-lines, animated-stripes, chevrons-moving-down, chevrons-moving-up, moving-dots, big-waves, small-waves, rotating-squares, rotating-crosses, circle-cascade, dancing-dots, sliding-squares, crazy-ellipse (unpredictable bounce loop), pacman, vector-animation, animated-repeater, splitting-cube-perfect-loop.

## 14. Pixel dissolve & pixel masks
Content fragments into/reveals through an animated pixel grid.
- **Recipe:** tile grid over content; stagger opacity/scale with `from:'random'`;
  or canvas mosaic reducing sample size over time.
- See: pixel-dissolve-transition, pixelated-mask, pixelated-slideshow.

## 15. Color keying & palette clamp
Footage mapped to a limited palette or a specific color replaced.
- **Recipe:** canvas: sample pixels, quantize to palette (clamp) or swap hue range
  (keying); CSS approximation: `filter: hue-rotate()` + blend-mode overlays.
- See: color-keying-effect, grainy-color-clamp.

## 16. Holographic shimmer
Iridescent foil color shifts sweeping across a mark.
- **Recipe:** conic/linear rainbow gradient clipped to the shape (`background-clip:text`
  or SVG mask), animate `background-position`/hue continuously.
- See: holo, holographic-logo.
