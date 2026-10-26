# Camera & Scene Language

How templates move the "camera" and transition between scenes. Exemplar slugs cited per move.

## 1. Slow push-in / pull-back
The most common scene opener: content scales gently (1.08→1 or 0.95→1) while fading in —
creates anticipation; "slow build and dramatic reveal" is the teaser house style.
- **Recipe:** `scale` 1.1→1 over 1.5–3s, `ease:'power2.out'`, paired with opacity.
- See: project-teaser, project-reveal, project-showcase, the-edit-collection-teaser, the-edit-fragrance-promo, mobile-screens-reveal (dramatic off-screen entrance variant).

## 2. Scale-from-center reveal
Hero element scales up into frame from its center — used for logos, rings, products.
- **Recipe:** `scale:0→1` back.out or expo.out; transformOrigin 50%.
- See: square-logo-scale, ring-scale, wow-rotate-and-scale (rotation + scale combo).

## 3. 3D rotation of cards & devices
Cards flip (`rotationY 90→0`) revealing content; phones/ NFT cards rotate in 3D space
to show multiple angles.
- **Recipe:** parent `perspective:1000px`; `rotationY`/`rotationX` tweens with
  `transformStyle:preserve-3d`; flip cards have two backface-hidden faces.
- **GSAP:** `gsap.from(card,{rotationY:-90,duration:.8,ease:'power3.out'})`
- See: card-flip, 3d-rotation, rotating-cards, nft-cards-3d, rotating-smartphones, rotating-mobile-screens-black-white, imac-cascade-apple-event (device cascades into frame).

## 4. Multi-directional slide-ins
Screens enter from different directions into one composition; single screens slide
horizontally in sequence.
- **Recipe:** per-item `x/y` from alternating off-screen sides, stagger 0.1–0.15, expo.out.
- See: sliding-smartphones, sliding-smartphones-stories, sliding-web-screens, animated-mobile-screens, animated-web-screens, sliding-blocks-apple-event (keynote-style block slide-ins), sliding-title-reveal-apple-event.

## 5. Parallax & mask parallax
Images move at different speeds (carousel) or inside a mask that moves at a different
rate than its content — depth without 3D.
- **Recipe:** content `y` tween 1.3× the mask's `y` on scroll/scrub.
- **GSAP:** `gsap.to(img,{yPercent:-15,scrollTrigger:{scrub:true}})` inside an overflow-hidden frame.
- See: image-carousel-parallax, image-mask-parallax-effect, mountains-animated-website-dribbble, website-promo (scroll reveals + layered screens).

## 6. Perspective tunnel
Gradient layers recede to a vanishing point — camera travels *through* color.
- **Recipe:** stacked frames scaling 0→large from center, staggered loop; or CSS
  `perspective` + `translateZ` steps animated forward.
- See: gradients-perspective-tunnel, kaleidoscope-intro-slide (unfolding symmetric variant).

## 7. Mask & split reveals
Scene opens through geometry: split-screen parts, inverted shapes, morphing shape masks.
- **Recipes:** split = two panels `xPercent:∓100` out; negative mask = clip-path cutout
  scaling up; morphing mask = clip-path/`d` tween while media sits inside.
- **GSAP:** `gsap.to('.panel-L',{xPercent:-100,ease:'power4.inOut',duration:.8})`; clip: `gsap.fromTo(el,{clipPath:'inset(50%)'},{clipPath:'inset(0%)'})`.
- See: the-edit-split-reveal, before-after-split-mask, design-negative-mask-effect, morph-video-mask, drop-it-like-it-s-hot-mask, the-edit-nested-images.

## 8. Wipes, sliders & swipes (before/after)
A divider glides across, wiping between two states/images.
- **Recipe:** top layer `clip-path: inset(0 X% 0 0)` tweened by drag or autoplay;
  handle follows the same x.
- **GSAP:** `gsap.to(top,{clipPath:'inset(0 0 0 60%)',ease:'power2.inOut'})` or Draggable.
- See: before-after-slider, before-after-swipe, before-after-side-by-side (static variant), before-after-logo.

## 9. Pixel & retro transitions
Scenes dissolve through an animated pixel grid or rewind like VHS.
- **Recipe:** pixel dissolve = grid of tiles (or SVG feTurbulence displacement /
  canvas mosaic) revealing in random stagger; rewind = `x` jitter + tracking-noise bars
  + fast reverse scrub feel.
- **GSAP:** `gsap.to('.px',{opacity:0,stagger:{each:.004,from:'random'}})` on a tile grid.
- See: pixel-dissolve-transition, pixelated-slideshow, pixelated-mask, rewind.

## 10. Blur & swirl transitions
Content distorts through a circular blur swirl or a focus-blur between scenes.
- **Recipe:** `filter: blur()` ramp + `rotation` on a duplicated layer, crossfade mid-blur;
  swirl adds a displacement/twirl (SVG filter or canvas).
- See: blur-swirl, blur-logo-switcher (blur crossfade between marks), motion-blur-text.

## 11. Stretch-warp transition
Image warps and pulls into the next scene — directional elastic warp.
- **Recipe:** `scaleX:1.3 + skewX` on outgoing, next scene enters behind; or WebGL/
  displacement-map warp for true stretch.
- See: image-stretch-transition, stretch, squeeze (element-level physical variants).

## 12. Keynote pacing (Apple Event series)
Measured presentation rhythm: one element per beat, clean slide/settle, generous holds.
- **Recipe:** scenes built of single moves at 0.8–1.2s expo.out with 0.5s+ holds between.
- See: sliding-blocks-apple-event, feature-list-apple-event, sliding-title-reveal-apple-event, imac-cascade-apple-event, magic-keyboard-specs-apple-event, homepod-mini-apple-event.

## 13. Cut-driven sizzle
No camera moves at all — hard cuts every 0.4–0.8s carry the energy; motion lives
inside each frame.
- See: drop-it-like-it-s-hot-sizzle-reel, the-edit-brand-promo, the-edit-poppy, the-track-promo-reel, the-track-slideshow.

## 14. Route drawing (travel narratives)
A path draws itself across a map between points, arriving at a destination/logo.
- **Recipe:** SVG polyline strokeDashoffset draw-on + marker dot following via
  MotionPathPlugin; destination pops at path end.
- **GSAP:** `tl.to(path,{strokeDashoffset:0,duration:2}).to(dot,{motionPath:{path},duration:2},0).from(pin,{scale:0,ease:'back.out(2)'})`
- See: the-route-cities, the-route-destinations-map, the-route-logo-reveal, the-route-new-destination, the-route-ios-flight-tracker, the-route-boarding-pass, the-route-destinations-carousel.
