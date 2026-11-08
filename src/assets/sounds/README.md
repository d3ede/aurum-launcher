# Launcher sounds

`minecraft-ready.wav` is an original Aurum cue synthesized without external samples.
It is a low 220 Hz tone with a quiet 330 Hz layer, a smooth 120 ms attack, and a fading tail.
There is no note sequence or bright bell overtone. Its peak is 7 dB quieter than the original cue.
The file is 1.35 seconds long, mono PCM, 48 kHz, 16-bit, with a peak of -21.4 dBFS.

Regenerate the exact file from the repository root:

```sh
node scripts/generate-game-ready-sound.mjs
```
