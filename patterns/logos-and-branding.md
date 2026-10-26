# Logos & Branding Patterns

Derived from `logos` (38) + `icons` (45) categories.

## 1. Scale-in mark
The mark scales up into frame — the clean default ident.
- **Recipe:** `scale:0.6→1` (or 0→1) + opacity, expo.out or slight back.out; 0.6–0.9s.
- **GSAP:** `gsap.from(logo,{scale:0,ease:'back.out(1.6)',duration:.7})`
- See: square-logo-scale, square-logo, round-logo (adds `rotation` + fade).

## 2. Ripple radiate
A ring ripples outward from the mark on reveal.
- **Recipe:** ring stroke scaling 0.5→2 while opacity 0.8→0; repeat 2–3× staggered or once.
- **GSAP:** `gsap.fromTo('.ring',{scale:.5,opacity:.8},{scale:2,opacity:0,duration:1.2,ease:'power2.out',repeat:2})`
- See: round-logo-ripple, ripple-effect (full-frame version).

## 3. Sliding name lockup
Mark lands first, brand name slides in beside it.
- **Recipe:** mark scale-in (§1), then text `x:-20→0` (or masked `yPercent`) 0.15s later.
- See: logo-sliding-name, round-logo-sliding-name.

## 4. Tap color reveal
A tap bursts the monochrome logo into its full color palette.
- **Recipe:** greyscale→color via `filter: grayscale(1→0)` + scale pop on tap;
  color orbs/pills burst outward from the tap point (polar tweens).
- See: logo-tap-color-reveal, color-ring-bounce-reveal (ring bounce pops orbs).

## 5. Blur switcher
Transition between marks through a shared blur — brand families, logo evolution.
- **Recipe:** outgoing `blur(0→12px)`+opacity out, incoming blur(12→0)+opacity in,
  overlap 50%; slight scale on both.
- **GSAP:** crossfade tweens on a timeline at position 0.3.
- See: blur-logo-switcher, before-after-logo (before/after rebrand variant).

## 6. Path-to-logo reveal
An animated path draws across the frame and *arrives at* the logo — story before mark.
- **Recipe:** strokeDashoffset draw-on + marker on MotionPath; logo pops at the end.
- See: the-route-logo-reveal.

## 7. Gradient-surface reveal
Shifting gradient layers gradually surface the mark.
- **Recipe:** logo as mask over animated gradient; gradient sweeps until mark reads,
  then holds.
- See: gradients-logo-reveal, gradients-perspective-tunnel.

## 8. Icon morphs
One icon fluidly morphs into another along a path or in place.
- **Recipe:** SVG path morph with matched point counts (`attr:{d}` tween / MorphSVG);
  along-a-path variant: icon travels MotionPath while crossfading into the next symbol.
- **GSAP:** `gsap.to(path,{attr:{d:d2},duration:.8,ease:'power3.inOut'})`
- See: morph-animated-icon, the-route-morphing-icons, morph-animated-weather-icons, morph-animated-face (expression morphs), morph-running-character (looped character morph).

## 9. Bouncy icon entrances
Icons bounce into view with springy physics; grids of app icons pop in sequence.
- **Recipe:** `scale:0→1` `elastic.out(1,0.5)` or `y:30→0` back.out, stagger 0.05–0.08.
- See: bouncy-icons, the-vault-app-icons, social-media-icons (coordinated sequence for end-cards).

## 10. Brand color pops
Palettes revealed as swatches: pills pop one-by-one, cards cascade/stack/expand/scale,
rows reveal cleanly.
- **Recipe:** variants of `scale`/`y` stagger per swatch (0.06–0.12); cascade adds
  per-index x+y drop; expand variant tweens `width` open then closed.
- See: color-pills-reveal, color-cards-cascade, color-cards-stack, color-cards-expand, color-cards-scaling-motion, bold-color-list, animated-color-pallette, color-ring-bounce-reveal.

## 11. Character/fruit brand moments
Objects interact with the wordmark: fruit bounces into serif type, spins through it,
floats between stacked lines.
- **Recipe:** object on a physics-feel arc (`y` gravity tween + bounce squash) timed to
  land as letters settle (text §2); rotation for spin-throughs.
- See: the-harvest-fruit-bounce, the-harvest-banana-spin, the-harvest-orange-float, the-harvest-raspberry-check, the-harvest-peach-plunge, the-harvest-pulp, the-harvest-raspberry-glide.

## 12. Minimal & specialty marks
Single animated dot; foil/holographic render; drawn curve logo; extruded type mark.
- **Recipe:** restraint — one property, one move (dot pulse/scale; shimmer sweep §effects-16;
  stroke draw-on; extrusion layer offsets).
- See: simple-dot-logo, holographic-logo, nike-curv-logo, openai-logo, text-extrusion, apple-logo (minimal motion), adobe-*-logo and social platform logos (facebook, twitter, instagram, behance, dribbble, spotify, youtube, twitch, tiktok — all clean scale/fade reveals, per §1).
