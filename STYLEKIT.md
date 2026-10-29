# Corporate Style Kit — premium public-site design language (brand-agnostic)

A reusable formula for public-facing sites and polished tools that need to read as
"expensive corporate." Fully portable: drop the current project's palette + logo into the token
slots below; the structure, motion, and rules stay the same. Keep this kit free of any specific
company's names, colors, or assets — per-project brand files live in the project, not here.

Internal ops dashboards skip the opener and marquee but keep the tokens, nav, and card rules.

## 1. Token slots (fill per project)
```css
:root{
  --ink:      /* deep dark ground (near-black, hue-biased toward accent) */;
  --surface:  /* secondary dark surface */;
  --accent:   /* THE brand color — used sparingly: logo, key words, one CTA */;
  --paper:    /* off-white light ground (#fafafa-ish, never pure gray) */;
  --mut:      /* muted text on dark */;
  --line:     rgba(255,255,255,.1);       /* hairlines on dark */
  --line-dark:rgba(0,0,0,.12);            /* hairlines on light */
}
```
One accent color total. Neutrals get a slight hue bias toward the accent — never pure mid-gray.

## 2. The opener (signature move)
A short intro splash before the homepage — an ANIMATED IDENTITY MOMENT, never a plain loading bar:
1. Dark ground; the brand's icon/mark DRAWS itself (SVG `stroke-dasharray` + `pathLength="100"`
   animation — rings sweep, strokes drop in).
2. An "activation" beat: tiny scale dip + accent glow bloom (`drop-shadow`) + 2–3 expanding
   ripple rings (`border` circles scaling up while fading).
3. Wordmark fades up; whole splash lifts away (`translateY(-100%)`, ~.85s, `cubic-bezier(.76,0,.24,1)`).
4. Total ≤ 4s, click/Enter to skip, removed from DOM on animationend, fully skipped under
   `prefers-reduced-motion`.
Debug trick: support a `?freeze=<ms>` query param that pauses every animation at that timestamp
(`document.getAnimations().forEach(a=>{a.pause();a.currentTime=ms})` inside double-rAF) —
invaluable for screenshotting exact frames in design review.

## 3. Page anatomy (in order)
1. **Minimal nav** — logo left, single "Menu" glass pill center (opens a full-screen overlay
   menu, not a link row), ONE accent pill CTA right ("Contact us →"). Nav is `absolute` inside
   the hero, not `fixed` (a light-section scroll would kill a light logo).
2. **Giant wordmark hero** — brand name huge and centered on the dark ground; subtle ambient
   canvas animation behind (flowing sine "energy" lines in accent at 5–14% alpha); tagline
   bottom-left with accent-colored key words ("Powering *X*. Elevating *Y*." pattern);
   "Scroll to explore" cue bottom-right with an animated drip line.
3. **Value-prop marquee** — uppercase ticker on the light deck; deck has 28–32px rounded TOP
   corners overlapping the hero; items separated by accent dots; edges masked with gradient fade;
   duplicate the list once and animate `translateX(-50%)` for a seamless loop.
4. **Photo-card sections** — big rounded (~28px) real photography, dark gradient overlay
   (`linear-gradient(200deg, transparent 30%, rgba(ink,.78) 85%)`), headline + short copy
   bottom-left, floating GLASS stat cards bottom-right.
5. **Numbered process** ONLY when content is a true sequence (01 → 02 → 03 → 04).
6. **Dark stat band** — rounded dark card, huge `tabular-nums` numbers, accent only on +/% marks,
   soft radial accent glow bleeding from one corner.
7. **Trusted-by strip** — muted uppercase lead-in + client names as quiet text (no logo soup).
8. **CTA card** — dark rounded card on light ground: one headline, one pill, one corner glow.
9. **Footer** — dark, small logo, one line.

## 4. Glass recipe (the "glassmorphism" cards)
```css
.glass{
  background:rgba(<ink-rgb>,.55);
  backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.16);
  border-radius:18px; /* chips: 999px */
}
```
Use for: floating stat cards on photos, caption chips on gallery tiles, a floating "About us"
card, the nav Menu pill. Always over imagery or gradient — glass on flat color reads as gray.

## 5. Pill buttons
Rounded-full, accent bg, dark text, arrow icon; hover = scale(1.03) + arrow nudges 3px right.
Everything interactive gets a visible `:focus-visible` outline in the accent.

## 6. Type
- ONE distinctive variable display face — inline as a @font-face data-URI when CSP blocks font
  CDNs. Headlines: heavy (620–660), slightly wide (105–112%), tight (-.02 to -.035em),
  `text-wrap:balance`.
- Uppercase micro-labels ("eyebrows") with .12–.16em tracking + a 22px accent dash before.
- Body ~15–16px/1.55, ~65ch max measure.

## 7. Motion rules
ONE orchestrated moment (the opener) + ONE ambient layer (hero canvas) + micro-hovers
(pill scale, card lift 4px, arrow nudge). Nothing else moves. Marquee ~30s/loop linear.
Everything honors `prefers-reduced-motion: reduce` (splash hidden, content visible statically).

## 8. Delivery notes
- Single-file page with every asset base64-embedded works to ~1.5MB; use CMS-generated resized
  image variants to keep photos ~100–190KB each.
- Real photography only — the style collapses with stock. Drone/architectural shots of actual
  sites are the single biggest quality lever.
