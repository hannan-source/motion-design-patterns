# Buttons & UI Micro-Interaction Patterns

Derived from `buttons` + `ui-elements` categories (≈90 templates).

## 1. Ambient glow pulse
A soft glow pulses around a CTA to draw the eye — attention without motion of the button itself.
- **Recipe:** `box-shadow: 0 0 24px accent` animating spread/opacity, 1.2–1.8s yoyo.
- **CSS:** `@keyframes glow {50%{box-shadow:0 0 32px 6px var(--c)}}` or GSAP yoyo repeat.
- See: glow-button, interactive-button-glow.

## 2. Frosted / liquid glass surfaces
Frosted or refractive glass with a shimmer sweep; "liquid glass" state changes are fluid.
- **Recipe:** `backdrop-filter: blur(20px) saturate(1.4)` + gradient shimmer `x` sweep;
  liquid variant adds a slight scale-squash on state change.
- **GSAP:** `gsap.fromTo('.shimmer',{xPercent:-120},{xPercent:220,duration:1.2,ease:'power2.inOut'})`
- See: glass-button, liquid-glass-toggle, liquid-glass-menu-vertical, liquid-glass-menu-horizontal, fluted-glass-background-ios.

## 3. Press state with personality
Emoji/label pops on press; cart buttons get a satisfying state change; split variant
separates into two panels on interaction.
- **Recipe:** press = `scale:0.92` (0.08s) → `back.out(3)` to 1; emoji pops `scale 0→1`
  with elastic; split = two halves `x:∓20` + reveal.
- **GSAP:** `gsap.fromTo(btn,{scale:.9},{scale:1,ease:'back.out(3)',duration:.35})`
- See: animated-emoji-button, view-cart-button, view-cart-button-split, continue-button-interaction, back-next-buttons.

## 4. Outline trace on press
An outline draws itself around the button's edges — hand-drawn quality.
- **Recipe:** SVG rect path, strokeDashoffset → 0 around perimeter on click.
- **GSAP:** `gsap.fromTo(rect,{strokeDashoffset:len},{strokeDashoffset:0,duration:.6,ease:'power2.inOut'})`
- See: interactive-button-trace.

## 5. Toggle snap
Thumb travels across the track and snaps into place; multi-toggle rows activate in sequence.
- **Recipe:** thumb `x` tween 0.25s `back.out(1.8)` + track color crossfade; sequence =
  stagger 0.15 across toggles.
- **GSAP:** `gsap.to(thumb,{x:on?22:0,duration:.25,ease:'back.out(1.8)'})`
- See: on-off-toggle, toggle-switch-button, purple-toggle, 3-toggle-switch-buttons.

## 6. System notification slide-in
iOS/Android-accurate: banner slides from top, pauses, slides out; lists stack in sequence.
- **Recipe:** `y:-120%→0` expo-out 0.5s, hold 2s, out power2.in; list = each notification
  pushes previous ones down (`y` + scale 0.95 on older items).
- **GSAP:** `tl.from(banner,{yPercent:-130,ease:'expo.out',duration:.5}).to(banner,{yPercent:-130,ease:'power2.in'},'+=2')`
- See: simple-notification-ios, push-notification-ios, push-notification-android, push-notifications-list-ios, new-message-notification-ios, the-vault-payment-notification, the-vault-payment-notifications.

## 7. Chat bubble sequence
Message bubbles appear in conversation rhythm, alternating sides.
- **Recipe:** per-bubble `y:12→0, opacity, scale:0.9→1` origin at bubble tail;
  0.4–0.7s gaps; typing indicator (3 dots pulse) before replies.
- **GSAP:** `tl.from(bubbles,{y:12,opacity:0,scale:.9,transformOrigin:'0 100%',stagger:.6,ease:'back.out(1.5)'})`
- See: whatsapp-messages, text-message-ios, animated-text-messages, the-prompt-ai-chat.

## 8. Search bar expand
Collapsed icon/pill expands into a full search field on interaction.
- **Recipe:** `width` (or scaleX origin-left) 44px→full, expo-out 0.4s; caret + placeholder fade in after.
- **GSAP:** `gsap.to(bar,{width:280,duration:.4,ease:'expo.out'})`
- See: animated-search-bar, search-bar-reveal, mobile-app-subscribe-field.

## 9. Expanding menus (FAB / side rail / nav)
Floating action button expands into an option fan; side rail slides from edge; nav
switches active state with a sliding indicator.
- **Recipe:** FAB → items `scale:0→1` + arc `x/y` positions, stagger 0.05, back.out;
  rail = `x:-100%→0`; nav pill = FLIP move of indicator to active item.
- **GSAP:** `gsap.from('.fab-item',{scale:0,stagger:.05,ease:'back.out(2)'})`; use Flip plugin for nav indicator.
- See: floating-action-menu, side-rail-menu, navigation-bar.

## 10. Loaders
Four house styles: circular spinner, pulsing bars, bouncing dots, spinner→success morph.
- **Recipes:** spinner = `rotation:360, repeat:-1, ease:'none'` (0.8–1.2s/rev);
  bars = `scaleY` yoyo stagger 0.1; dots = `y` bounce stagger 0.12;
  success = spinner stroke morphs into checkmark (dashoffset swap) + green pop.
- **GSAP:** bars: `gsap.to('.bar',{scaleY:.3,yoyo:true,repeat:-1,stagger:.1,duration:.4})`; success: timeline dashoffset→check path.
- See: loading-spinner-infinite-loop, pink-loading-spinner, loading-animation-bars, dancing-dots, bouncy-period, loading-spinner-success-animation, circular-loader.

## 11. Like / heart burst
Heart fills and bursts particles; like counters pop.
- **Recipe:** icon `scale 0→1.3→1` elastic + fill swap; burst = 6–8 dots radiating
  (`x/y` polar, opacity→0); counter pops `scale 1→1.25→1`.
- **GSAP:** `gsap.fromTo(heart,{scale:0},{scale:1,ease:'elastic.out(1.2,.4)',duration:.5})` + particle timeline.
- See: instagram-like, heart-icon, like-icon, dislike-icon, like-badge, instagram-interactions.

## 12. Badges & ratings
Badges pop/light up; stars enter as a burst or rise row; store badges use a clean scale-in.
- **Recipe:** pop = `scale 0→1` back.out(2.5) stagger 0.08; rise = `y:24→0` stagger;
  light-up = brightness/glow flash on a loop for achievements.
- **GSAP:** `gsap.from('.star',{scale:0,ease:'back.out(3)',stagger:.08})`
- See: new-badge, interactive-badges, 5-stars-pop, 5-stars-move-up, black-app-store-badge, white-app-store-badge, google-play-badge, product-of-the-week-product-hunt.

## 13. Stateful action button (generate/subscribe)
Button cycles idle → loading → success: label swaps, progress fill, check.
- **Recipe:** timeline: label fade → width shrink to circle w/ spinner → expand back with
  success state (check icon + color swap).
- See: the-prompt-generate-button, youtube-subscribe-button (click + bell), the-prompt-voice-search (waveform while listening: bars `scaleY` random yoyo).

## 14. Profile signals
Story ring appears around avatar; live badge pulses.
- **Recipe:** ring = conic-gradient stroke dash draw-on; live dot = `scale/opacity` pulse loop.
- **GSAP:** `gsap.from(ring,{rotation:-90,opacity:0,duration:.6,ease:'power2.out'})`; pulse: `gsap.to(dot,{scale:1.6,opacity:0,repeat:-1,duration:1.2})`
- See: profile-new-story, profile-live.

## 15. Widgets & component sets
Whole kits animate together; cursors get custom trails; sliders feel draggable.
- **Recipe:** components stagger in on a shared grid rhythm; cursor trail = N divs
  lerped to pointer with decreasing lag; slider thumb `x` with resistance ease.
- See: animated-ui-kit, interactive-components, yosemite-animated-widget, cursor, opinion-slider, animated-color-pallette, animated-arrow (looping cue), before-after-slider/swipe (drag reveal, see camera-and-scene).
