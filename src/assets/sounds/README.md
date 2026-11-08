# Launcher sounds

`minecraft-ready.wav` is an original Aurum cue synthesized without external samples.
It contains two gently overlapping notes (C4 and E4, about 262 and 330 Hz),
with a smooth 70 ms attack and a fading tail, without bright bell overtones.
The file is 1.35 seconds long, mono PCM, 48 kHz, 16-bit, with a peak of -18.1 dBFS.

Regenerate the exact file from the repository root:

```sh
node scripts/generate-game-ready-sound.mjs
```
