# Social Media & Showcase Patterns

Derived from `social-media` (115 templates — the largest category) + `showreels`.

## 1. Orbit showreel
Content pieces orbit a central point in a continuous loop.
- **Recipe:** items positioned by angle θ on a circle; animate θ uniformly
  (`rotation` on a container + counter-rotation on items to keep them upright).
- **Feel:** constant linear rotation; items scale/opacity by depth if faked-3D.
- **GSAP:** `gsap.to(ring,{rotation:360,duration:20,repeat:-1,ease:'none'})` + `gsap.to(item,{rotation:-360,...})`.
- See: orbit-social-media-showreel, orbit-cards.

## 2. Spiral entrance
Content enters the frame along a spiral path.
- **Recipe:** animate polar (r, θ) → final x/y; or MotionPathPlugin on a spiral path,
  scale 0.4→1 as it travels.
- **GSAP:** `gsap.from(el,{scale:.4, motionPath:{path:spiral}, duration:1.2, ease:'power2.out'})`
- See: spiral-social-media-showcase.

## 3. Mirror layout
Content reflected symmetrically — motion mirrored across an axis.
- **Recipe:** duplicate with `scaleX:-1` (or Y), run identical timeline on both halves;
  mask seam with gradient.
- See: mirror-social-media-showcase, text-mirror-effect (typographic version).

## 4. Stacked-card testimonial
Quotes/cards reveal one at a time from a stack; each new card pushes the stack back.
- **Recipe:** active card `y/rotation` in with back.out; older cards step down:
  `y += 12, scale -= 0.04, opacity -= 0.15` per depth level. Use a function that
  re-lays-out the stack on each advance.
- **GSAP:** Flip plugin for re-stacking, or `gsap.to(cards,{y:i=>i*12,scale:i=>1-i*.04})`.
- See: the-stack-testimonial, stacked-cards, the-stack-sale, the-stack-release-notes, the-stack-partnership, the-stack-we-re-hiring, the-vault-animated-cards, blur-news-stack-ios, rotating-cards (flip-in variant), the-vault-card-reveal.

## 5. Multi-panel synchronized edits
2–3 frames move in sync — same timeline, offset content (duo/trio comparisons).
- **Recipe:** one timeline driving all panels; keep easing identical, vary only content.
- See: the-edit-duo, the-edit-trio, the-edit-nested-images (images nested inside each other).

## 6. Story layouts (Instagram format)
9:16 multi-image layouts: 2–5 images with animated reveals/transitions per cell; collage
variants overlap as if assembled.
- **Recipe:** per-cell `scale 0.9→1 + opacity` stagger 0.15; captions slide up masked;
  swipe-up prompt = arrow `y` yoyo loop + pulsing pill.
- **GSAP:** `gsap.from('.cell',{scale:.9,opacity:0,stagger:.15,ease:'power3.out'})`
- See: instagram-story-2-images … instagram-story-5-images, instagram-story-2-images-with-captions, instagram-stories-collage, instagram-story-pastel, instagram-story-fashion, the-edit-instagram-story, instagram-story-browse-more.

## 7. Messaging narrative
Stories told through chat bubbles (see buttons-and-ui §7 for the mechanic); social
variants add avatars and platform-accurate chrome.
- See: whatsapp-messages, text-message-ios, animated-text-messages, animated-tweet (tweet card pop-in).

## 8. Engagement pops
Likes, comments, counts pop in sequence as social proof.
- **Recipe:** heart burst (buttons-and-ui §11) + counter tick-up; sequence multiple
  reactions with 0.3s gaps.
- See: instagram-interactions, instagram-like, like-badge, youtube-subscribe-button.

## 9. Seamless slideshow loop
Frames cycle with no visible cut — end state matches start state.
- **Recipe:** crossfade/zoom where last frame = first frame; or infinite track
  (content ×2, translate −50%, repeat).
- **GSAP:** `gsap.to(track,{xPercent:-50,duration:12,ease:'none',repeat:-1})`
- See: slideshow-loop, slideshow-social-media-showreel, the-track-slideshow, pixelated-slideshow (pixel-dissolve variant), gallery-scroll (continuous scroll variant).

## 10. Parallax carousel
Carousel layers move at slightly different speeds — instant depth.
- **Recipe:** translate foreground 1.0×, mid 0.6×, background 0.3× of drag/tween delta.
- **GSAP:** drive all layers from one `progress` value: `gsap.to(fg,{x:-d}); gsap.to(bg,{x:-d*.3})`.
- See: image-carousel-parallax, the-route-destinations-carousel, blur-bubbles-carousel (blurred bg + sharp fg).

## 11. Bento showcase
Grid cells reveal in a structured sequence; gradient variants give each cell its own
animated fill. Aspect variants: 1:1, 4:5, 16:9.
- **Recipe:** per-cell `scale 0.85→1, opacity`, stagger from center or top-left;
  cell content starts animating only after its cell lands.
- **GSAP:** `gsap.from('.cell',{scale:.85,opacity:0,stagger:{each:.08,grid:'auto',from:'center'}})`
- See: bento-grid, bento-1-1, bento-4-5, bento-16-9, bento-modular-showreel, gradients-bento.

## 12. Grids & cascades of screens
Screens/photos enter a grid in staggered cascades; sliders swipe horizontally;
grids animate as one coordinated sequence.
- **Recipe:** stagger from one corner or center, `y:40→0` or scale; "cascade" =
  diagonal drop (each item offset in x AND y by index).
- **GSAP:** `stagger:{each:.06,grid:[r,c],from:'start'}`
- See: cascading-screens, cascading-mobile-screens, mobile-screens-grid, web-screens-grid, mobile-gallery-grid, web-gallery-grid, animated-square-images, animated-web-gallery, animated-mobile-gallery, mobile-screens-slider, cascading-squares-grid.

## 13. Kinetic brand promos (The Track / The Edit / Blast)
Fast-cut promos: big type + imagery, quick cuts, builds to a reveal; taglines drop the
product onto a dark stage.
- **Recipe:** scenes 0.6–1.2s; type snap-ins (text §3) over scale-pushing imagery
  (`scale 1.1→1` slow push); final reveal = mask split or settle.
- See: the-track-product-reveal, the-track-promo-reel, the-track-tagline, the-edit-brand-promo, the-edit-product-launch, the-edit-poppy, blast-social-media-showcase, drop-it-like-it-s-hot-sizzle-reel.

## 14. Slow-luxury promos
Opposite pole: atmospheric, cinematic cuts, long holds (fragrance/fashion).
- **Recipe:** 3–5s scenes, slow `scale` push 1→1.08, crossfades, minimal type motion.
- See: the-edit-fragrance-promo, the-edit-collection-teaser, project-teaser, project-reveal, feature-sneak-peek (partial reveal teaser).

## 15. Lower-thirds & handles
A handle/name slides in as a lower-third bar over footage.
- **Recipe:** bar `scaleX` from left + text masked slide-up; hold; out.
- See: white-social-handle, black-social-handle.

## 16. Announcement formats
Hiring/partnership/livestream/sale cards; food brand moments (Harvest/Crust series);
event cards.
- **Recipe:** card pop (§4) + one hero motion (fruit bounce, price tick); see
  text-animation for the type layer.
- See: the-stack-* series, the-harvest-* series, the-crust-* series, save-the-date, thank-you-config, ready-for-config, live-memoji, share-your-work.
