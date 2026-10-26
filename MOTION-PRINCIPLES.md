# Motion Principles — the "premium look" rules inferred from the Jitter catalog

Apply these across every scene. They are the difference between default-looking
animation and Jitter-grade motion.

## 1. Two easing families only
The catalog runs on exactly two feels:
- **Snappy/physical** — for entrances meant to be *felt*: text snaps, toggles, pops,
  bounces. Use `back.out(1.4–3)`, `elastic.out(1, 0.4–0.6)`, or a stiff spring.
  (see: stretch-snap-text, elastic-text, bouncy-icons, on-off-toggle, 5-stars-pop)
- **Smooth/confident** — for premium reveals: expo/power deceleration with a long,
  quiet tail. Use `expo.out` or `power3.out`.
  (see: motion-blur-text, sliding-title-reveal-apple-event, the-vault-card-reveal)
Never use linear for entrances; linear is reserved for loops and marquee motion.

## 2. Overshoot, then settle
The recurring described behavior is "rise and settle", "collide and settle",
"stretch and snap back". Land past the target by 4–15% and recover:
`scale/position` overshoot via `back.out(1.4–2)` — one bounce maximum.
(see: bar-chart-skyline, bold-text-snap, tilted-text-snap, stretch, squeeze)

## 3. Stagger discipline
- Stagger interval scales with element size: chars 0.015–0.03s, words 0.05–0.08s,
  lines/cards/cells 0.08–0.15s, panels 0.15–0.25s.
- Use spatial origins: `from:'center'` for symmetric pops (morph-inflating-text),
  `from:'random'` for pixel dissolves (pixel-dissolve-transition),
  `grid:[r,c], from:'start'` for grid cascades (bento-grid, cascading-squares-grid).
- One stagger axis per scene — don't stagger both the container and its children
  on the same beat.

## 4. Perfect-loop construction
Looping backgrounds/graphics must have no visible seam:
- Translate loops: duplicate content ×2, move exactly −50% (motion-design-looped-text,
  slideshow-loop, moving-lines).
- Rotation loops: uniform `rotation:360, ease:'none'` (circular-loader, orbit showreels).
- Ambient loops: use sine.inOut yoyo tweens with **non-integer duration ratios**
  (5s/7s/11s) across layered elements so the composition never visibly repeats
  (gradients-morphing-shapes, blur-bubbles).
- State loops: end state == start state (splitting-cube-perfect-loop).

## 5. Rhythm: in → hold → out
Scene-level timing follows a three-beat structure: entrance (0.5–1.2s) → hold for
reading (1–3s, longer for luxury: 3–5s per the-edit-fragrance-promo) → exit or
transition (0.4–0.8s). Announcement/notification templates always hold
(push-notification-ios holds ~2s before exiting).

## 6. Duration ranges
- Micro-interactions (toggle, like, tap): 0.15–0.4s.
- Element entrances (text lines, cards, bars): 0.5–0.9s.
- Hero reveals, chart draw-ons, mask opens: 0.8–1.6s.
- Scene transitions: 0.6–1.0s (fast-cut promos) or 1.5–3s (cinematic pushes).
- Ambient/background loops: 4–12s per cycle.

## 7. One hero motion per scene (restraint)
Every template is built around a single dominant idea: the fruit bounce, the blur
focus-pull, the pixel dissolve. Supporting elements get minimal treatment (fade +
8px drift — see `appear`). If two "hero" techniques compete in one scene, remove one.
Contrast pairs work though: kinetic foreground over an ultra-calm background
(blur-bubbles-carousel, small-waves).

## 8. Layering & depth over speed
Depth is manufactured, not rendered: parallax speed ratios (1.0/0.6/0.3 —
image-carousel-parallax), blurred backgrounds behind sharp foregrounds
(blur-article-gallery-ios), drop-shadow + scale separation in card stacks
(the-stack-testimonial), mirrored duplicates (mirror-social-media-showcase).
Prefer these to faster motion when a scene feels flat.

## 9. Blend modes do the visual heavy lifting
For editorial/artistic scenes, animate simple properties (position, scale, rotation)
of plainly-shaped layers and let `mix-blend-mode` (multiply/overlay/screen/difference)
create the richness (blend-modes-* series, multiply). Cheaper and more organic than
animating colors directly.

## 10. System accuracy for UI realism
When mimicking an OS, timing must feel native: iOS notifications slide in ~0.5s
spring, hold, dismiss; toggles snap in ~0.25s; message bubbles appear in conversational
gaps (0.4–0.7s). Slow or eased-wrong UI motion reads as fake instantly
(simple-notification-ios, new-message-notification-ios, liquid-glass-toggle).

## 11. Blur as a transition currency
Blur is the catalog's favorite transition glue: blur-in focus pulls (motion-blur-text),
blur crossfades (blur-logo-switcher), swirl distortions (blur-swirl), speed blur
(blur-text-scroller). Ramp blur symmetric with opacity and keep peak blur mid-transition.

## 12. Counters and charts decelerate into their final value
Always `expo.out` on count-ups and fills so motion "arrives"; never constant-speed
counting (counter-progress-ring, animated-bar-chart, counter-1-000-figma-plugin-installs).
Sync the visual fill and the number from one tween's progress.

## 13. Physical squash vocabulary
For "alive" UI: press = scale 0.9–0.95 for ~0.1s then back.out release; bounce landings
squash (scaleY 0.85) then recover; stretch moves borrow (scaleX↑ + scaleY↓) to
conserve volume (stretch, squeeze, animated-emoji-button).

## 14. Mask everything textual
Professional type reveals come out of overflow-hidden windows, never bare fades:
line masks (sliding-text-reveal), split masks (before-after-split-mask), negative
masks (design-negative-mask-effect), morphing masks (morph-video-mask).
