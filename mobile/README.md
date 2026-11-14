# Hertz Forge — mobile playlist

A phone version of the desktop **playlist mode**: playlists of brainwave rows
(binaural beats, amplitude modulation, bilateral panning, FM), chained playback,
`.hfc` config import/export and offline WAV export.

It is a **PWA** — plain HTML/CSS/JS with no build step and no dependencies — so it
installs to an Android home screen like an app and runs offline. The same files
can be wrapped into an APK with Capacitor (below) when you want a Play Store build.

## Run it

```bash
cd mobile/app
python -m http.server 8080 --bind 127.0.0.1     # desktop browser
python -m http.server 8080 --bind 0.0.0.0       # reachable from your phone
```

Open `http://localhost:8080` locally, or `http://<your-pc-ip>:8080` on the phone
(same Wi-Fi). Audio needs a **secure context**: `localhost` counts, a plain LAN IP
does not for install/offline features — for phone testing either use
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` (add
`http://<your-pc-ip>:8080`), or host it over HTTPS later.

## Install on Android

Chrome → menu → **Add to Home screen / Install app**. It then opens full-screen
without browser chrome, keeps its own icon, and works offline after the first load.

## Using it one-handed

- The **bottom dock** is always visible: previous/next playlist, play/pause, stop,
  the current playlist + row with elapsed time, a progress line, and a volume
  popover.
- **Pause** suspends the audio clock, so resuming continues from the exact
  position. **Stop** (the red ■ next to the transport) ends playback.
- During playback the dock **follows the playing row** into view. If you scroll
  to edit something, it leaves the page alone for a few seconds, then follows
  again on the next track.
- Rows start **collapsed** as a one-line summary (mode, carrier/beat, duration).
  Tap anywhere on a row header to open its parameters; tap again to fold it.
  The chevron is also a real button and announces expanded/collapsed state.
- Playlist headers **stick** under the top bar while you scroll its rows.
- `loop`, `shuffle` and the overflow menu (`⋯`) stay in the top bar; new
  playlist and `.hfc` loading live in the overflow menu.
- A playlist's or row's `⋯` opens a **bottom action sheet** (export, duplicate,
  move, save, load, delete). Delete asks for confirmation in the same sheet.
  Escape, the backdrop and **Cancel** close it.
- Adding or duplicating a row keeps the page where it was, keeps the caret in a
  field you are editing, and keeps the add button under your thumb.
- Every button, checkbox and input is sized for a thumb (44px minimum), and
  inputs use 16px text so iOS does not zoom on focus.
- Icons are inline SVG from a sprite in `index.html`, so play/pause/stop,
  prev/next, volume, import, add, more, the chevrons and the sheet actions look
  the same on Android, iOS and desktop instead of falling back to platform
  emoji. `loop` and `shuffle` stay as labelled text toggles.
- Name and number fields move above the dock when focused, and **Enter**
  dismisses the keyboard. The dock stays above the keyboard rather than hiding
  (the viewport uses `interactive-widget=resizes-content`).


## What carries over from the desktop app

- Same DSP math (`playlist_forge/engine.py`): sine/triangle/saw/square oscillators,
  brainwave envelope, tanh bilateral crossfade, phase-shift FM, `tanh` soft clip,
  per-channel volume then master volume.
- Same row model: carrier / wave / BW / amp / bilateral / FM / vol per side, sync,
  binaural centre frequency, row duration, include flags.
- Same playlist semantics: loop, shuffle (reshuffled per cycle when looping),
  "rows" playback limit.
- Same `.hfc` JSON format and filename generator, so configs move both ways.

Deliberate differences: playlist chaining uses the top-bar **loop/shuffle** over
playlists (the desktop app does the same), the phone UI keeps transport in a
bottom dock, and export is rendered in one pass with loop disabled.

## Known limits

- WAV export is capped at **15 minutes** and renders at 44.1 kHz (mobile memory).
  Export louder/quieter material by adjusting the master volume first — it is
  baked into the file, exactly like the desktop app.
- The `tkinterdnd2` file-drop reordering is replaced with ↑/↓ buttons; the row
  grip dragging of the desktop app has no touch equivalent yet.
- iOS Safari supports the app but may suspend audio when the screen locks.

## Wrapping as an Android APK

Two routes: the bundled no-Gradle build script below, or Capacitor. Both wrap the
same `mobile/app/` PWA.

```bash
bash mobile/android/build.sh      # -> mobile/build/hertz-forge-playlist.apk
```

The script uses the Android SDK command-line tools (no Gradle, no Android Studio)
and defaults to `<repo>/.android-sdk`; set `HF_SDK` to a space-free SDK path if it
lives elsewhere. `mobile/android/src/` holds the Java WebView shell and
`AndroidManifest.xml`; intermediates go to `mobile/android/build/`.

With Capacitor instead:

```bash
cd mobile/app
npm init -y
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/android
npx cap init "Hertz Forge" com.hertzforge.playlist --web-dir=.
npx cap add android
npx cap sync android
npx cap open android          # builds/runs from Android Studio
```

Capacitor serves the app from `https://localhost`, which is a secure context, so
the AudioWorklet and the service worker keep working.

## Files

Everything phone-related lives under `mobile/`; the repo root holds only the
desktop Python app.

```
mobile/
├── app/                    the PWA itself (no build step)
│   ├── index.html              shell
│   ├── css/app.css             mobile styling
│   ├── js/dsp-core.js          shared DSP + scheduler (also runs inside the worklet)
│   ├── js/processor.js         AudioWorkletProcessor wrapper
│   ├── js/audio.js             transport, offline render, WAV encoder
│   ├── js/model.js             row/playlist model, .hfc format, localStorage
│   ├── js/ui.js                rendering, editing, playback queue, import/export
│   ├── manifest.webmanifest    install metadata
│   ├── sw.js                   offline shell cache
│   ├── icons/                  app icons
│   └── tools/make_icons.py     regenerates the icons
├── android/                APK wrapper (WebView shell + no-Gradle build)
│   ├── AndroidManifest.xml
│   ├── src/com/hertzforge/     Java activity
│   └── build.sh                builds mobile/build/hertz-forge-playlist.apk
├── dist/                   generated web bundle uploaded for hosting (gitignored)
├── build/                  generated APK output (gitignored)
├── site-worker.js          static-host worker for the deployment
├── site-manifest.json      deployment manifest (assetsDirectory: ./dist)
└── README.md               this file
```

## Hosting (installed app on a phone)

Android only offers a real "Install app" for a PWA served over **HTTPS**. The
hosted copy lives at:

```
https://site-183b132c480b4f5a873adf87b7e34ee9.freebuff.page
```

That deployment is built from `mobile/app/` by copying the public files into
`mobile/dist/` and uploading it with `mobile/site-manifest.json` (static
`mobile/site-worker.js` + `assetsDirectory: ./dist`). To ship a change:

```bash
cd mobile
rm -rf dist && mkdir -p dist
cp -r app/index.html app/css app/js app/icons \
      app/manifest.webmanifest app/sw.js dist/
```

then redeploy `mobile/site-manifest.json` to the site's preview environment and
publish it again. Keep `sw.js`'s `CACHE` name bumped when you change cached files.
