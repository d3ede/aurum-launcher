// Original Aurum UI sound. Deterministic synthesis, no external samples.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sampleRate = 48000;
const duration = 1.35;
const frames = Math.round(sampleRate * duration);
const notes = [
  { start: 0.025, frequency: 587.3295, gain: 0.7 },
  { start: 0.17, frequency: 739.9888, gain: 0.78 },
  { start: 0.335, frequency: 880, gain: 0.82 },
];
const samples = new Float64Array(frames);
let peak = 0;
for (let frame = 0; frame < frames; frame++) {
  const time = frame / sampleRate;
  let sample = 0;
  for (const note of notes) {
    const age = time - note.start;
    if (age < 0) continue;
    const attack = 1 - Math.exp(-age / 0.012);
    const decay = Math.exp(-age / 0.23);
    const phase = 2 * Math.PI * note.frequency * age;
    // Soft, rounded mallet tone with a quiet upper partial; no sharp click.
    sample += note.gain * attack * decay * (
      Math.sin(phase) + 0.12 * Math.exp(-age / 0.14) * Math.sin(2 * phase)
    );
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
  wav.writeInt16LE(Math.round(samples[frame] / peak * 0.19 * 32767), 44 + frame * 2);
}
const output = resolve(dirname(fileURLToPath(import.meta.url)), "../src/assets/sounds/minecraft-ready.wav");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, wav);
console.log(`Created ${output} (${duration}s, ${sampleRate} Hz, peak -14.4 dBFS)`);
