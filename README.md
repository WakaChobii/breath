# breath
Personal breath work app — a single-screen 4s-in/6s-out breathing pacer (PWA).

## Voice cues (Speechify)

The app can speak "Inhale" / "Exhale" at each phase boundary. Because this is a
static site with no backend, the audio is **pre-generated** into small static
files and shipped with the app — the Speechify API key is never embedded in the
client and is never committed.

### Regenerate the audio

You only need to do this once (or when you want a different voice):

```sh
# Rotate/create a key in the Speechify dashboard, then keep it in your env only:
export SPEECHIFY_API_KEY=sk_...
node tools/generate-voice.mjs
```

This writes `audio/inhale.mp3` and `audio/exhale.mp3`. Commit those files (never
the key) and deploy. Optional overrides:

```sh
VOICE_ID=henry MODEL=simba-english node tools/generate-voice.mjs
# List voices available to your account:
curl -s https://api.sws.speechify.com/v1/voices \
  -H "Authorization: Bearer $SPEECHIFY_API_KEY"
```

The vocabulary is fixed (see `CUES` in `tools/generate-voice.mjs`); add a row
there if the UI grows.

### Runtime behaviour

- Cues play only when the files exist and voice is enabled — everything fails
  silently otherwise, so the visual pacer is never affected.
- The 🔊/🔇 button (top-right) toggles voice; the choice is remembered in
  `localStorage`.

## Security note

Never put the API key in `app.js`, `index.html`, `manifest.json`, CI, or any
file served from GitHub Pages — a public static site hands every asset to every
visitor. The key stays in your shell environment when running the generator, and
nowhere else.
