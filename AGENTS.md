# Agent instructions

## Commit and push after every change

Every modification in this repository must end with a **commit and a push** —
never leave work uncommitted or unpushed at the end of a task or a step.

1. Make the change.
2. Verify it (syntax check, build, or the relevant manual/browser check).
3. `git add` only the files that belong to the change (never build output or
   anything under a gitignored path).
4. Commit with a descriptive message (e.g. `feat(mobile): ...`, `fix: ...`,
   `docs: ...`, `chore: ...`).
5. `git push origin <current-branch>`.

If the push is rejected, run `git pull --rebase`, resolve, re-verify, and push
again. Do **not** force-push.

When a task naturally splits into independent modifications, commit and push
each one separately rather than batching them into a single final commit.

## Repository layout

- Repo root: desktop Python app (`hertz_forge/`, `playlist_forge/`, `run*.py`).
- `mobile/`: everything phone-related.
  - `mobile/app/` — the PWA (plain HTML/CSS/JS, no build step, no dependencies).
  - `mobile/android/` — APK wrapper and `build.sh`.
  - `mobile/dist/` — generated hosting bundle (gitignored).
  - `mobile/build/` — generated APK output (gitignored).
  - `mobile/ERGONOMICS_PLAN.md` — phone UX plan and phase status.
- `.android-sdk/` is toolchain state and must stay untracked.

## Before committing

- Mobile JS: `node --check mobile/app/js/<file>.js`.
- Mobile UI: serve `mobile/app/` and check the change in Chrome device emulation
  (320, 360, 393, 412px), including no horizontal overflow.
- If UI behaviour changed, update `mobile/README.md` and the relevant phase note
  in `mobile/ERGONOMICS_PLAN.md`.
- Bump the `CACHE` name in `mobile/app/sw.js` whenever cached mobile assets
  change.
- APK: `bash mobile/android/build.sh` (requires `platforms/android-34` and
  `build-tools/35.0.0`; set `HF_SDK` to a space-free SDK path if needed).

## Conventions

- Keep the mobile app dependency-free vanilla HTML/CSS/JS unless explicitly
  agreed otherwise.
- Do not change DSP maths, the row/playlist model, or the `.hfc` format as part
  of UI work.
- Prefer small, reviewable changes that leave the app working.
