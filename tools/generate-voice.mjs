#!/usr/bin/env node
// Pre-generate the spoken breath cues as static audio files.
//
// This is the ONLY place the Speechify API key is used, and it runs on your
// machine, not in the browser and not in CI. The key is read from the
// SPEECHIFY_API_KEY environment variable and is never written to disk or
// committed. The output (audio/inhale.mp3, audio/exhale.mp3) is what ships.
//
// Usage:
//   SPEECHIFY_API_KEY=sk_... node tools/generate-voice.mjs
//
// Optional overrides:
//   VOICE_ID=henry            # a Speechify voice id (see list below)
//   MODEL=simba-english       # Speechify TTS model
//
// List available voices for your account:
//   curl -s https://api.sws.speechify.com/v1/voices \
//     -H "Authorization: Bearer $SPEECHIFY_API_KEY" | jq '.[].id'

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API_URL = 'https://api.sws.speechify.com/v1/audio/speech';
const KEY = process.env.SPEECHIFY_API_KEY;
const VOICE_ID = process.env.VOICE_ID || 'henry';
const MODEL = process.env.MODEL || 'simba-english';

// The full fixed vocabulary of the app. Add rows here if the UI grows.
const CUES = [
  { file: 'inhale.mp3', text: 'Inhale' },
  { file: 'exhale.mp3', text: 'Exhale' }
];

if (!KEY) {
  console.error('Missing SPEECHIFY_API_KEY environment variable.');
  console.error('Run: SPEECHIFY_API_KEY=sk_... node tools/generate-voice.mjs');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'audio');

async function synth(text) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      input: text,
      voice_id: VOICE_ID,
      model: MODEL,
      audio_format: 'mp3'
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Speechify ${res.status} for "${text}": ${body}`);
  }

  const data = await res.json();
  // The API returns base64-encoded audio in `audio_data`.
  if (!data.audio_data) {
    throw new Error(`No audio_data in response for "${text}": ${JSON.stringify(data).slice(0, 300)}`);
  }
  return Buffer.from(data.audio_data, 'base64');
}

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const cue of CUES) {
    process.stdout.write(`Synthesizing "${cue.text}" -> audio/${cue.file} ... `);
    const buf = await synth(cue.text);
    await writeFile(join(outDir, cue.file), buf);
    console.log(`ok (${buf.length} bytes)`);
  }
  console.log('\nDone. Commit the audio/ files (NOT your key) and deploy.');
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exit(1);
});
