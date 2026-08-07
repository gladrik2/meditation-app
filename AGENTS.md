# Permanent repository instructions

## Architecture

- Use React, TypeScript, and Vite.
- Use the Web Audio API for playback and keep one shared `AudioContext` per application instance.
- Prefer browser-standard APIs and small, well-maintained dependencies.
- Core functionality must support current Chrome, Edge, and Firefox releases.
- Do not use Chromium-only APIs for required features; use feature detection for browser differences.

## Privacy

- User audio must remain local to the user's device and must never be uploaded.
- Never add telemetry containing filenames or audio contents.
- Never commit user audio, secrets, or credentials.

## Verification

Before completing a change, run and fix failures introduced by the change:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Repository restrictions

- Do not commit `dist/` or other generated build output.
- Do not add binary files unless specifically requested.
- Use text-based SVG when an image or icon can reasonably be represented as text.
- Do not perform unrelated refactors.
