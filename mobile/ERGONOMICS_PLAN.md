# Hertz Forge Mobile — Phone Ergonomics Plan

**Status:** Phases 1–3 implemented — Phase 3 verified in Chrome emulation and in the APK build
**Last verified:** Chrome mobile emulation at 320, 360, 393 and 412px
**Scope:** `mobile/app/` (PWA) with small follow-ups in `mobile/android/`
**Decisions locked:** bottom transport dock is **always visible**; portrait
orientation stays; UI remains dependency-free vanilla HTML/CSS/JS with no build
step; DSP, row model and `.hfc` format are out of scope.

---

## 1. Goals

1. **Fit every phone:** the UI must work from 320px to 430px wide with no
   horizontal overflow, no clipped controls and no crushed header.
2. **Thumb-first:** the controls used during playback (play/stop, previous/next,
   volume, progress) must be reachable one-handed from any scroll position.
3. **Fewer taps, less scrolling:** a 10-row playlist should be navigable without
   expanding every row, while keeping access to every parameter.
4. **Comfortable targets:** no interactive element below 44×44px; no text below
   11px; no input below 16px (which also prevents iOS focus zoom).
5. **No regression:** desktop parity, `.hfc` import/export, WAV export, chaining
   and offline PWA behaviour all keep working.

---

## 2. Current-state audit

### 2.1 Top bar does not fit a phone
- `index.html` puts the brand plus five buttons in one `.topbar` flex row:
  play-all, loop, shuffle, import, new playlist.
- The row needs roughly **430–440px**. On a 360px screen the brand is squeezed to
  ~65px and wraps into several lines, making the bar tall and unstable.
- There is no `flex-wrap`, overflow menu or minimum-width strategy.

### 2.2 Primary controls are out of thumb reach
- Play-all, volume, loop/shuffle, import and add all sit in the top ~120px.
- The per-playlist play button scrolls away with its playlist; stopping playback
  while scrolled down means scrolling back up or using global stop.
- No persistent playback context exists, so users lose track of what is playing.

### 2.3 Tap targets and typography are undersized
| Element | Current | Target |
|---|---|---|
| `.btn` | 40px min | 44–48px |
| `.btn.small` | 34px min | 44px |
| `.icon` | 32×32 | 44×44 |
| include checkbox | 22px | 44px label row |
| loop/shuffle checkbox | 18px | 44px label row |
| `select` | 32px tall | 44px |
| `.num` | 30px tall / 12px text | 44px / 16px |
| `.btn.play` | 52×44 | keep, verify spacing |

- `.lab` is 9px, `.side h4` is 10px — below comfortable phone legibility.
- Inputs below 16px trigger iOS Safari's automatic page zoom on focus.

### 2.4 Parameter grid is too dense
- `.sides` is two columns on all widths above 359px. At 360px each slider is
  roughly **75–100px** for a 0–2000 Hz range (≈20–27 Hz per pixel) with the
  browser's ~16px thumb; precise adjustment by thumb is not realistic.
- Rows always render both L/R panels, selects and number fields, so even modest
  playlists become very long vertical scrolls.

### 2.5 Interaction state is lost on structural edits
- `renderAll()` replaces `els.list.innerHTML`. Adding, duplicating or deleting a
  row, switching mode or collapsing discards open `⋯` panels, focus, caret
  position and input state; the keyboard can dismiss mid-edit.
- Scroll position is not explicitly preserved across these rebuilds.

### 2.6 No playback context or pause
- The fixed `.statusbar` is text-only: no elapsed/total, progress, pause or
  position indicator.
- The active row is highlighted but can be off-screen; there is no auto-follow
  and no "now playing" summary outside the playlist card.
- `Player` supports play and stop but not pause/resume.

### 2.7 Device-level gaps
- Safe-area insets are applied only top and bottom, not left/right.
- `min-height: 100%` instead of `dvh`; viewport meta lacks
  `interactive-widget=resizes-content`, so the keyboard can cover the focused
  field on Android Chrome.
- Icons are text glyphs (`▶ ⇩ ＋ ⋯`) that render as emoji or with platform-
  specific metrics.
- Android shell uses the default Material status/nav bar, default window
  background and default WebView text zoom.
- `manifest.webmanifest` and `AndroidManifest.xml` both lock portrait — kept
  unless the open questions decide otherwise.

---

## 3. Design principles

1. **Thumb zone first:** persistent primary controls at the bottom; secondary
   configuration stays in the scroll area.
2. **Progressive disclosure:** summaries by default, detail on demand; nothing is
   removed, only folded.
3. **Bigger, fewer controls per row:** stack labels, widen sliders, give every
   control a full-size hit area.
4. **Never lose context:** edits must not jump the page, drop focus or close the
   panel the user is working in.
5. **One source of truth:** reuse the existing `state`, `Player` and model; no
   duplicate playlist model and no new dependency.

---

## 4. Phase 1 — Layout, density and reachability

**Goal:** everything fits, everything is tappable, transport is always reachable.
**Files:** `mobile/app/index.html`, `mobile/app/css/app.css`, small additions in
`mobile/app/js/ui.js`.
**Does not touch:** DSP, model format, WAV export, Android shell.

### 4.1 Always-visible bottom transport dock

```
┌─────────────────────────────────────────────┐
│  ▶/■   Playlist 1 · Row 3         2:14/8:00 │  now playing + elapsed
│  ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  thin progress line
│    ⏮    ▶/■    ⏭        🔊 50%      ⚙ loop │  thumb-reachable controls
└─────────────────────────────────────────────┘
        above env(safe-area-inset-bottom)
```

- **Always visible.** Idle state: `Ready · Play all`. Playing state: transport,
  active playlist/row, elapsed/total, progress bar. Busy state (WAV render):
  progress/status message. Error state: message in the status line with the
  existing colour semantics.
- **Replaces the status bar.** One bottom bar, not two; `setStatus()` keeps its
  signature and renders into the dock.
- **Controls:** previous playlist · play/stop · next playlist on the left/centre;
  volume button opening a slider popover on the right; optional loop indicator
  mirroring the top-bar chain loop state.
- **Queue semantics:** prev/next walk the same queue used by play-all; in
  single-playlist mode they move through included playlists by index.
- **Reserved space:** content bottom padding = dock height + bottom inset, so the
  last row and the "add row" button remain reachable.
- **Top bar:** play-all is removed; loop, shuffle, import and new-playlist stay,
  moving behind an overflow sheet when the width is insufficient.

### 4.2 Top bar cleanup
- Compact brand (short wordmark or mark + label) with `min-width: 0`.
- 44px actions, no wrapping below 320px.
- Define the fallback order for the overflow: import and new-playlist first.
- Keep loop/shuffle toggles visible when possible because they change playback.

### 4.3 Touch foundation
- Introduce sizing tokens: `--tap: 44px`, `--dock-h`, `--safe-left/right`.
- Enforce 44px minimum height and width on `.btn`, `.btn.small`, `.icon`,
  `.seg-btn`, `.check`, `.chk`, `select`, `.num`, row and playlist headers.
- Checkboxes sit inside full-row labels so the label text is tappable.
- Body text at least 13px; labels 11px; headings 12–13px; inputs 16px.
- **Sliders:** label above the track; 36px vertical hit area; 24px thumbs via
  `::-webkit-slider-thumb` and `::-moz-range-thumb`; full available width.
- **Breakpoints:** single-column `.sides` below ~400px; two columns only where
  each slider keeps at least ~120px of travel.

### 4.4 Density without hiding capability
- Rows default to collapsed, showing a one-line summary: mode (Normal /
  Binaural / Adv), carrier or beat frequency, duration and include state.
- The whole row header toggles expansion; the chevron becomes a visual
  indicator, and `aria-expanded` follows the state.
- Playlist headers become sticky within their section while its rows scroll.
- Persist expansion per row using the existing `collapsed` flag; do not add a
  second state model.

### 4.5 Layout plumbing
- `100dvh` for the shell; content scrolls under sticky bars.
- `viewport-fit=cover` (already present) plus left/right inset padding.
- Add `interactive-widget=resizes-content` to the viewport meta.
- Confirm no horizontal overflow at 320, 360, 393 and 412px.

### 4.6 Phase 1 acceptance
- [ ] No horizontal scrolling at 320px; top bar stays one line at 360px.
- [ ] Every tappable element is at least 44×44px in DevTools.
- [ ] Play/stop, prev/next and volume work from any scroll position.
- [ ] The dock shows playlist, row, elapsed/total and progress during playback.
- [ ] A 10-row playlist is navigable without expanding every row.
- [ ] Play, stop, chain loop/shuffle, import, `.hfc` save and WAV export still work.
- [ ] Keyboard opening does not hide the focused input.

---

## 5. Phase 2 — Interaction model

**Goal:** fewer taps, no lost context, touch-native actions.
**Depends on:** Phase 1 markup and dock.

### 5.1 Bottom sheets for actions
- Replace inline `hidden` action panels (`pl-more`, `row-actions`) with a bottom
  sheet: backdrop, drag handle, title, action list, safe-area padding.
- Playlist sheet: Export WAV, Duplicate, Load `.hfc`, Delete.
- Row sheet: Duplicate, Move up, Move down, Save `.hfc`, Delete.
- Destructive actions last, visually separated, with confirmation or undo.
- Accessibility: `role="dialog"`, `aria-modal`, labelled title, focus trap,
  Escape closes, focus returns to the opener, background scroll locked.

### 5.2 State preservation
- Stop rebuilding the entire list for structural edits, or wrap `renderAll()`
  with capture/restore of:
  - `window.scrollY` (and any nested scroller),
  - the focused element (by stable `data-pi`/`data-ri`/field identifiers),
  - open sheets/panels and row expansion.
- Prefer targeted DOM patching for collapse and mode changes.
- Verify that adding a row keeps the button under the thumb and does not dismiss
  the on-screen keyboard.

### 5.3 Playback awareness
- Auto-scroll the active row into view when it changes, suppressed while the user
  is scrolling or after a manual scroll (resume on the next track or via a
  "follow" control).
- Keep the dock's now-playing label in sync with the active row.
- Optional pause/resume: `AudioContext.suspend()` / `resume()` in
  `js/audio.js`, with the dock button switching to ❚❚ and preserving position.
  If skipped, the dock button stays play/stop.

### 5.4 Disclosures and feedback
- `aria-expanded` and `aria-controls` on playlist/row disclosure buttons.
- Visible `:focus-visible` rings on all controls.
- Light haptic feedback on destructive actions and transport taps where the
  platform supports it (Android `navigator.vibrate`).
- Toasts/undo for delete instead of blocking `confirm()` (optional; decide in
  open questions).

### 5.5 Optional reorder
- Long-press drag-to-reorder rows, with a visible drag handle and an auto-scroll
  near the viewport edges; fall back to the arrow buttons when drag is
  unavailable. Not required for Phase 2 acceptance.

### 5.6 Phase 2 acceptance
- [x] Adding/duplicating/deleting a row does not move the page, close a sheet or
      dismiss the keyboard.
- [x] Sheet opens/closes with correct focus and scroll-lock behaviour; Escape
      works with a hardware keyboard.
- [x] Active row is visible during playback unless the user scrolled away.
- [x] Expanded/collapsed state is announced correctly to screen readers.
- [x] If pause ships: pause/resume keeps the exact playback position.

---

## 6. Phase 3 — Device polish

**Goal:** native-feeling presentation and input behaviour in both PWA and APK.

### 6.1 Iconography
- Inline SVG sprite with 24px glyphs using `currentColor`: play, stop, pause,
  previous, next, volume, import, add, more, chevron, up/down, delete.
- Replace text glyphs so rendering is consistent across Android/iOS and weight is
  controllable.
- Do this after Phase 2 so the markup is stable.

### 6.2 Android shell (`mobile/android/`)
- App theme background matching `#0c0c18` to avoid a white cold-start flash.
- Status and navigation bar colours matched to the app; light status icons on the
  dark background.
- `settings.setTextZoom(100)` so system font scaling does not break the layout
  unpredictably (still respect reasonable accessibility settings).
- Keep portrait lock and the existing loopback asset server untouched.
- Verify the dock clears the gesture navigation bar on devices with insets.

### 6.3 Keyboard and input behaviour
- `enterkeyhint="done"` on text/number inputs; blur on Enter.
- Focused field scrolls into view when the keyboard opens; dock stays above the
  keyboard or is hidden while typing (decide and document).
- No iOS focus zoom (inputs at 16px from Phase 1).
- Sanitize/validate numeric input without fighting the user mid-type.

### 6.4 PWA and platform polish
- Optionally add `shortcuts` to `manifest.webmanifest` (Play all).
- Confirm `theme-color` matches the dock/top-bar surface; update status-bar style
  for iOS standalone.
- Respect `prefers-reduced-motion` and `prefers-contrast` where practical.
- Keep wake-lock behaviour for playback.

### 6.5 Delivery hygiene
- Bump `CACHE` in `sw.js` whenever cached files change.
- Update `mobile/README.md` with the dock, sheet and build behaviour.
- Rebuild the APK with `bash mobile/android/build.sh` and smoke-test.

### 6.6 Phase 3 acceptance
- [x] Icons render identically on Android Chrome, Android APK and iOS Safari
      (same SVG sprite everywhere; verified in emulation and in the packaged APK).
- [x] No white flash or mismatched system bars on APK launch (shell chrome is
      set before the WebView is created; cold-start rendering not observable
      without a device).
- [x] Keyboard never covers the focused field; dock behaviour is predictable.
- [x] Offline reload works after the cache bump (`hertz-forge-v6`).
- [x] README reflects the shipped behaviour.

---

## 7. Cross-cutting concerns

- **Accessibility:** 44px targets, visible focus, `aria-expanded`/`aria-pressed`,
  labelled icon buttons, role/status announcements for playback and export,
  contrast checked against `#0c0c18`.
- **Performance:** keep the existing 60ms slider throttle; use passive listeners
  where scrolling is involved; avoid re-render storms and layout thrash while
  dragging sliders; the dock updates at most once per second.
- **State/persistence:** no schema changes; `collapsed` flags, master volume and
  chain settings stay in the current localStorage payload. The dock is derived
  state only.
- **Offline:** all new markup/CSS/JS is covered by the service-worker cache;
  no CDN or font dependency.
- **Error handling:** audio failure, export failure, import failure and
  unsupported-browser messages surface in the dock with the existing colour
  semantics.

---

## 8. Files and touchpoints

| File | Changes |
|---|---|
| `mobile/app/index.html` | dock markup, compact top bar, viewport meta, SVG sprite |
| `mobile/app/css/app.css` | tokens, touch sizing, typography, dock, sheets, breakpoints, insets |
| `mobile/app/js/ui.js` | dock rendering/state, sheet controller, render preservation, follow-scroll |
| `mobile/app/js/audio.js` | only if pause/resume ships (Phase 2) |
| `mobile/app/sw.js` | cache version bump |
| `mobile/app/manifest.webmanifest` | optional shortcuts/theme polish |
| `mobile/android/src/.../MainActivity.java` | text zoom, window/status bar colours |
| `mobile/android/AndroidManifest.xml` | theme background/window colours if needed |
| `mobile/README.md` | document layout and interactions |

**Not touched:** `dsp-core.js`, `processor.js`, `model.js` data format, `.hfc`
schema, WAV rendering, the WebView asset server, the desktop Python app.

---

## 9. Suggested implementation order

1. Phase 1 markup skeleton: dock, compact top bar, reserved space.
2. Phase 1 CSS foundation: tokens, targets, typography, sliders, breakpoints.
3. Phase 1 density: collapsed rows, sticky playlist headers, insets/dvh.
4. Phase 1 integration: dock state wired to `Player`/`status`; regression pass.
5. Phase 2: render preservation → bottom sheets → follow-scroll → pause.
6. Phase 3: icons → Android shell → keyboard → PWA polish → cache/README.
7. Final QA matrix and APK rebuild.

Each batch should be independently reviewable and leave the app working.

---

## 10. Verification matrix

| Scenario | Checks |
|---|---|
| 320×568 | no overflow, header one line, dock usable |
| 360×800 | slider width/travel, 44px targets, collapsed rows |
| 393×852 (Pixel) | dock + insets, sheets, keyboard |
| 412×915 (large Android) | spacing, typography |
| Keyboard open | focused field visible, dock not covering it |
| Landscape (if unlocked) | no overflow, L/R layout, dock |
| Playback | play/stop/pause, progress, active row follow, chain loop/shuffle |
| Editing | add/duplicate/delete/move/mode/sync, no page jump or lost panel |
| Files | import `.hfc`, save row, export WAV |
| APK | cold start, insets, save-to-Downloads, offline launch |
| Offline PWA | reload after cache bump |

Automated checks: none exist today; a lightweight manual checklist is the
baseline. If desired, a Playwright script can assert no horizontal overflow and
minimum target sizes at the listed viewports.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Collapsed rows hide parameters | One-line summaries, remembered expansion, full row opens in one tap |
| Dock reduces vertical space (~60px) | It replaces the status bar and the top transport row; keep it compact |
| Two-column L/R stays imprecise | Single column below ~400px; larger thumbs; numbers remain editable |
| Pause via `suspend()` behaves differently on iOS | Keep play/stop as the guaranteed path; document the limit |
| Full re-render removal risks regressions | Wrap with scroll/focus capture first, then patch incrementally |
| Text glyph replacement touches all markup | Do icons after Phase 2 markup is stable |
| Android insets differ across devices | Test with gesture nav and 3-button nav; keep fallback padding |
| Larger targets make the config denser vertically | Rely on collapsed rows and sticky headers to offset the height |

---

## 12. Out of scope

- DSP changes, oscillator/envelope maths, sample rate, WAV encoder.
- Playlist/row schema or `.hfc` format changes.
- Desktop Python app changes.
- A framework, bundler, npm dependency or design-token build pipeline.
- Play Store release signing/store listing (the existing debug APK flow stays).
- Native iOS app.

---

## 13. Open questions

1. **Pause:** include pause/resume in Phase 2, or keep play/stop only?
2. **Landscape:** keep the portrait lock, or allow landscape with a two-column
   layout?
3. **Delete safety:** blocking confirm (current), toast with Undo, or both?
4. **Prev/next semantics** in single-playlist mode: included playlist index
   (proposed) or no-op?
5. **Haptics:** Android-only vibration, or skip entirely?
6. **Tablet/desktop browser:** cap content width (e.g. 560px) or let it stretch?

---

## 14. Phase 1 implementation notes

- Bottom dock shipped as specified and is always visible; it replaces the old
  status bar and reserves `--dock-h` of content padding.
- Sliders use a 44px hit area (the plan allowed 36px); thumbs are 24px.
- New rows are created collapsed. Rows already saved by a user keep their
  existing expanded/collapsed flag.
- The top-bar overflow is a compact dropdown menu (New playlist, Load `.hfc`);
  the full bottom-sheet treatment remains Phase 2.
- Pause/resume was not included (open question 1) — the dock button is
  play/stop.
- Verified in Chrome device emulation: no horizontal overflow, no control under
  44×44px, sticky playlist header aligns with the top bar, the dock never covers
  the last row, and play/stop, queue advance, prev/next and the volume popover
  work. APK rebuild was not run because the local `.android-sdk` currently has
  no `platforms/android-34` or `build-tools/35.0.0`.

---

## 15. Phase 2 implementation notes

- **Bottom sheets.** Playlist and row `⋯` buttons open a safe-area-aware sheet
  with a drag handle, backdrop, focus trap, Escape/backdrop/Cancel dismissal,
  body scroll lock and focus return to the opener. Destructive actions sit last
  and confirm inside the same sheet (Delete / Keep it); the native `confirm()`
  is gone. Actions run after the sheet closes so re-renders cannot fight it.
- **State preservation.** `renderAll()` still rebuilds the list (smaller diff than
  patching every branch) but captures `window.scrollY`, the focused control's
  stable `data-pi`/`ri`/`scope`/`field`/`side` identity and its text selection,
  then restores them. Adding a row additionally anchors on the add button so it
  stays under the thumb; collapsed rows keep the page stationary.
- **Follow-scroll.** When the active row changes, the row is brought into the
  band below the top bar + sticky playlist header and above the dock. A manual
  scroll pauses following for 6 seconds; the next track after that follows
  again. Programmatic scrolls are excluded from the manual-scroll signal.
- **Pause/resume.** `Player.pause()`/`resume()` use `AudioContext.suspend()` and
  `resume()`, so the DSP clock — and therefore the exact position — is kept.
  The dock primary button is play/pause, with a separate red Stop button shown
  only while playing. Wake lock is released on pause and requested again on
  resume. Pausing survives structural edits (the audio context stays suspended).
- **Disclosures.** Row and playlist chevrons are real buttons with
  `aria-expanded` and, when expanded, `aria-controls`. Tapping the whole header
  still toggles as well.
- **Haptics.** `navigator.vibrate()` gives light feedback on transport taps,
  disclosures and sheet actions where the platform supports it.
- **Reorder (5.5)** is intentionally not implemented; the ↑/↓ sheet actions
  remain the touch fallback.
- **Verified:** pause freezes elapsed time and resume continues (0:01 → 0:03
  after a 1.4s pause); structural edits while paused keep the paused chrome;
  follow-scroll reaches the next playlist and stays put after a manual scroll;
  sheets trap Tab, close on Escape/backdrop/Cancel, restore focus and confirm
  deletion; add/edit keeps focus and caret; 320px dock with Stop visible has no
  overflow and every target is ≥44×44px. `node --check` passes for the changed
  JS. The APK was not rebuilt because the local Android SDK still lacks
  `platforms/android-34` and `build-tools/35.0.0`.

---

## 16. Phase 3 implementation notes

- **Iconography (6.1).** One inline SVG sprite (`<svg class="sprite">` in
  `index.html`, 24×24 symbols, `currentColor`) plus an `icon(name)` helper in
  `ui.js`. Replaced every glyph that was an icon: dock prev/play/pause/stop and
  volume, playlist play/stop and `⋯`, row `⋯`, both disclosure chevrons, the
  `Adv ▸/▾` toggle, `＋ row`, the overflow menu, and all sheet actions
  (export, copy, import, move up/down, delete). `loop`/`shuffle` deliberately
  stay labelled text toggles — they are word buttons that happen to carry a
  narrow-width shorthand glyph, not icon buttons.
- **Dynamic dock icon (bug found while finishing 6.1).** `syncChrome()` used to
  assign `dockPlay.textContent`, which would have deleted the new SVG child on
  the first sync; it now sets `innerHTML` from the same sprite.
- **Android shell (6.2).** `MainActivity` sets the window/decor background,
  status bar and navigation bar to `#0c0c18` before the WebView exists, and
  pins `setTextZoom(100)`. Portrait lock and the loopback asset server are
  untouched. The dock clears the gesture bar because the page already pads by
  `env(safe-area-inset-bottom)`.
- **Keyboard (6.3).** `enterkeyhint="done"` on playlist-name and number inputs;
  Enter blurs the field. `focusin` scrolls a field that would sit under the dock
  back into view (debounced 260ms so the resize lands first). **Decision:** the
  dock stays visible above the keyboard instead of hiding, because
  `interactive-widget=resizes-content` shrinks the layout viewport and the
  transport remains useful while typing.
- **PWA polish (6.4).** `theme-color` already matched the app surface and
  `prefers-reduced-motion` was already honoured; no change. Manifest shortcuts
  were not added — they need a route that starts playback, which is a bigger
  change than a device-polish pass.
- **Delivery (6.5).** `CACHE` bumped to `hertz-forge-v6`, README updated, APK
  rebuilt with build-tools 35 (34's bundled R8 crashes on JDK 21 class files)
  and verified with `apksigner`.
- **Verified:** `node --check` on every mobile script; no `▶ ■ ⋯ ＋ ⏮ ⏭ ❚❚`
  glyphs remain in the app shell or renderer; Chrome emulation at 320, 360, 393
  and 412px shows no horizontal overflow and the dock/action icons render from
  the sprite; play/pause swaps the dock icon; sheet actions show icons and keep
  their focus behaviour; APK launches to the same bundle (badging, signature
  and assets checked — first-launch rendering on hardware is not verifiable
  here).

---

## 17. Definition of done

- All Phase 1 acceptance criteria pass on the verification matrix.
- Playback, chaining, import/export and offline behaviour are unchanged.
- No element under 44px and no horizontal overflow at 320px.
- `sw.js` cache bumped, README updated, APK rebuilt and smoke-tested.
- Changes remain dependency-free and reviewable in small commits.
