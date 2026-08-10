# Built-in audio assets

Place audio files shipped with the application in this directory. Vite copies
everything under `public/` to the root of the production build, so an asset
named `soft-bell.ogg` here is available at
`${import.meta.env.BASE_URL}audio/built-in/soft-bell.ogg` in application code.
Using `BASE_URL` keeps asset URLs working both locally and under the GitHub
Pages repository path.

Keep this directory for application-provided audio only. Audio selected by a
user must remain local to their browser and must never be copied here,
uploaded, or committed.

Before adding an asset:

- Confirm that the project has permission to redistribute it.
- Prefer lowercase, kebab-case filenames that describe the sound.
- Document the source, license, creator, and any required attribution in this
  file or in a neighboring text manifest.
- Check the encoded format in current Chrome, Edge, and Firefox releases; add
  alternate encodings when one format does not provide the required coverage.
- Keep files reasonably small and optimized for web delivery.

Built-in audio is not currently included in the PWA precache. Update the
Workbox configuration deliberately if these assets must be available offline.
