# Charts & Data Patterns

Derived from the source library's `charts` category (17 templates) plus counter/progress templates
scattered through `ui-elements` and `social-media`.

## 1. Growing bars from baseline
Bars scale from the shared baseline with clean, purposeful timing.
- **Recipe:** `scaleY: 0→1`, `transformOrigin: bottom`, stagger left→right.
- **Feel:** power3.out, 0.6–0.8s per bar; "rise and settle" implies a tiny overshoot.
- **GSAP:** `gsap.from('.bar', {scaleY:0, transformOrigin:'50% 100%', duration:0.7, ease:'back.out(1.4)', stagger:0.08})`
- See: animated-bar-chart, bar-chart-skyline, bar-chart-sleep-tracker.

## 2. Horizontal bars slide-in + expand
Bars enter sideways, then lengthen to value — leaderboard feel.
- **Recipe:** `x: -20→0` + `scaleX: 0→value`, origin left; stagger rows.
- **GSAP:** `gsap.from('.hbar', {scaleX:0, x:-16, transformOrigin:'0 50%', stagger:0.1, ease:'expo.out'})`
- See: horizontal-bar-chart-metrics.

## 3. Multi-series simultaneous build
Several bar/line series animate at once for comparison — no stagger, synchronized.
- **Recipe:** same tween started together; differentiate by color only.
- **GSAP:** `gsap.from('.series', {scaleY:0, transformOrigin:'bottom', duration:0.9, ease:'power3.out'})`
- See: multiple-bar-chart, stacked-bar-chart, multiple-line-chart-green.

## 4. Line draw-on
A line chart draws itself across the frame.
- **Recipe:** SVG path `strokeDasharray = len; strokeDashoffset: len→0`.
- **Feel:** power2.in-out, 1–1.6s; add dot markers popping at data points.
- **GSAP:** `gsap.to(path, {strokeDashoffset:0, duration:1.4, ease:'power2.inOut'})`
- See: animated-line-chart-blue, animated-line-chart-purple, line-chart-user-acquisition.

## 5. Donut ring sweep
Ring fills around its circumference to a percentage.
- **Recipe:** circle stroke, `strokeDashoffset = C*(1-p)→target`; rounded linecap.
- **Feel:** expo-out; often paired with a count-up in the center.
- **GSAP:** `gsap.to(ring, {strokeDashoffset:C*(1-0.72), duration:1.2, ease:'expo.out'})`
- See: animated-donut-chart, animated-donut-chart-black, progress-donut, progress-pie.

## 6. Donut segments in sequence
Multi-part donut: each segment sweeps in after the previous.
- **Recipe:** per-segment dashoffset tween chained on a timeline; stagger 0.15–0.25.
- **GSAP:** `tl.to(seg1,{...}).to(seg2,{...},'-=0.1').to(seg3,{...},'-=0.1')`
- See: donut-chart-3-parts, stacked-donut-chart (rings stacked + sequenced).

## 7. Layered chart cascade
Chart layers/panels cascade into place one after another — builds anticipation.
- **Recipe:** per-layer `y:+40→0` + `opacity`, stagger 0.12, slight rotation optional.
- **GSAP:** `gsap.from('.layer', {y:40, opacity:0, stagger:0.12, ease:'power3.out'})`
- See: stacked-chart-cascade, grid-chart-split (panels split + populate).

## 8. Number count-up
Numeric value ticks from 0 (or start) to target while the visual fills.
- **Recipe:** object tween + `snap:{val:1}` (or 0.1); format with separators.
- **Feel:** expo-out so the count decelerates into the final number.
- **GSAP:** `gsap.to(o,{val:1000,duration:1.6,ease:'expo.out',snap:{val:1},onUpdate:()=>el.textContent=o.val.toLocaleString()})`
- See: counter-1-000-figma-plugin-installs, counter-poster, halftone-counter-poster, counter-pixel.

## 9. Progress ring + counter combo
Circular progress ring fills while the percentage counts up in sync.
- **Recipe:** drive both from one tween's progress: dashoffset and textContent in onUpdate.
- **GSAP:** `gsap.to(o,{p:76,duration:1.4,ease:'expo.out',onUpdate:()=>{ring.style.strokeDashoffset=C*(1-o.p/100); label.textContent=Math.round(o.p)+'%'}})`
- See: counter-progress-ring, progress-bar (linear variant), dotted-counter-circle.

## 10. Radar morph
A simple line morphs into a full radar chart — the chart is "earned", not just shown.
- **Recipe:** path `attr:{d}` morph from flat polyline to radar polygon (equal point count).
- **GSAP:** `gsap.to(path, {attr:{d:radarD}, duration:1, ease:'power3.inOut'})` (same #points; or MorphSVG).
- See: morph-line-to-radar-chart.

## 11. Stylized counters
The counter itself is the poster: halftone dots, pixel grid, frost, blur, glitch.
- **Recipes:** halftone = radial-gradient dot tiling behind digits; pixel = digits
  rendered on an animated dot grid; blur = digits sharpen from blur(10px) while counting;
  glitch = flicker via stepped opacity/clip jumps.
- See: halftone-counter-poster, counter-pixel, frosted-glass-counter, blur-counter, clock-counter.

## 12. Live-instrument gauges
Real-time-feel instruments: watch hands, charging pulse, flight data.
- **Recipe:** rotate hands with `rotation` tween; battery pulse = `scale/opacity` yoyo loop.
- **GSAP:** `gsap.to(hand,{rotation:360,duration:60,repeat:-1,ease:'none'})`; `gsap.to(batt,{opacity:.4,yoyo:true,repeat:-1,duration:.8})`
- See: wristwatch, charging-apple-watch, the-route-ios-flight-tracker.
