// Original Aurum UI sound. Deterministic synthesis, no external samples.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sampleRate = 48000;
const duration = 1.35;
const frames = Math.round(sampleRate * duration);
const peakLevel = 0.085;
const notes = [
  { start: 0.025, frequency: 220, gain: 1 },
  { start: 0.025, frequency: 330, gain: 0.16 },
];
const samples = new Float64Array(frames);
let peak = 0;
for (let frame = 0; frame < frames; frame++) {
  const time = frame / sampleRate;
  let sample = 0;
  for (const note of notes) {
    const age = time - note.start;
    if (age < 0) continue;
    const attack = Math.sin(Math.min(age / 0.12, 1) * Math.PI / 2) ** 2;
    const decay = Math.exp(-age / 0.3);
    const phase = 2 * Math.PI * note.frequency * age;
    // A low, softly voiced tone, with no note sequence or bright bell partials.
    sample += note.gain * attack * decay * Math.sin(phase);
  }
  const fade = Math.min(1, Math.max(0, (duration - time) / 0.15));
  samples[frame] = sample * fade * fade;
  peak = Math.max(peak, Math.abs(samples[frame]));
}
const wav = Buffer.alloc(44 + frames * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(frames * 2, 40);
for (let frame = 0; frame < frames; frame++) {
  wav.writeInt16LE(Math.round(samples[frame] / peak * peakLevel * 32767), 44 + frame * 2);
}
const output = resolve(dirname(fileURLToPath(import.meta.url)), "../src/assets/sounds/minecraft-ready.wav");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, wav);
console.log(`Created ${output} (${duration}s, ${sampleRate} Hz, peak ${(20 * Math.log10(peakLevel)).toFixed(1)} dBFS)`);
