# Local Soundscape

Local Soundscape is a client-side audio mixer for layering local audio into a personal listening environment. It is designed for current Chrome, Edge, and Firefox releases on Android, Windows, and Linux, including installation as a Progressive Web App.

## Current capabilities

- Select multiple local audio files and one optional image through one upload control.
- Play or pause each track, or start all ready tracks together.
- Treat audio of 10 seconds or less as a sound effect, with an adjustable random per-second playback chance and a 10-second cooldown.
- Adjust per-track and master volume and stop all playback.
- Remove tracks and see clear unsupported/unreadable-file errors.
- Add one local soundscape image and view it in theater or browser full-screen mode.
- Install the application and reopen its cached shell offline.
- Responsive, keyboard-accessible controls for mobile and desktop screens.

## Technology

React, strict TypeScript, Vite, the Web Audio API, `vite-plugin-pwa`, Vitest, React Testing Library, ESLint, and Prettier. There is no backend, database, account system, or native wrapper.

## Privacy model

Audio and the optional soundscape image are read through standard browser APIs and held locally in memory. Short effects use Howler.js and its shared Web Audio context, while long tracks use persistent HTML audio elements. Files, file contents, and filenames are not uploaded, sent to analytics, or added to service-worker caches. Selected files are forgotten on refresh or close.

## Development

Requires Node.js 24 LTS or newer and npm.

```bash
npm install
npm run dev
```

Useful quality commands:

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:watch
```

Create a type-checked production build with:

```bash
npm run build
```

Build output is written to ignored `dist/`.

Application-provided audio assets belong in `public/audio/built-in/`. See the
README in that directory for URL, licensing, format, and offline-cache
guidance. User-selected audio must never be placed there or committed.

## PWA behavior

The generated service worker precaches only the application shell (`html`, JavaScript, CSS, and SVG). Updates are activated automatically. After one successful online visit, the shell can launch offline; selecting and playing files remains local. Browser support for install prompts and SVG manifest icons varies, but neither affects core playback.

## GitHub Pages deployment

`.github/workflows/deploy-pages.yml` verifies formatting, lint, types, tests, and the production build before deploying `dist/` with the official Pages Actions. On GitHub Actions, Vite derives the project base path from `GITHUB_REPOSITORY`, so no username or repository name is hard-coded.

After merging to `main`, a repository administrator must open **Settings → Pages** and set **Source** to **GitHub Actions**. The workflow then runs on pushes to `main` or manually from the Actions tab.

## Current limitations

- Browser codec support determines which audio formats decode successfully.
- Tracks are held in memory, so very large or numerous files may exceed mobile memory limits.
- Pause positions are tracked by the audio clock; tracks that naturally reach their end reset to the beginning.
- File access is intentionally not persisted between sessions.
- The first playback gesture may be needed to resume audio due to browser autoplay policies.
- Advanced mixing, waveform rendering, effects, panning, looping, and persistent libraries are not yet implemented.

## Future possibilities

Potential later work includes synchronized transport improvements, mute/solo, panning, looping, fades, visualizations, and effects. Tauri desktop packaging or Capacitor mobile packaging may be evaluated in the future; neither is a current dependency or part of this web application.
