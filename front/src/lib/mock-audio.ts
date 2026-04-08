export type MockAudioOptions = {
  durationSec: number;
  sampleRate?: number;
  toneHz?: number;
  amplitude?: number;
  noiseAmplitude?: number;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Generate a simple mono PCM16 WAV Blob.
 * This is used as a frontend-only mock when backend audio isn't wired yet.
 */
export function createMockWavBlob({
  durationSec,
  sampleRate = 22050,
  toneHz = 220,
  amplitude = 0.22,
  noiseAmplitude = 0.02,
}: MockAudioOptions): Blob {
  const safeDuration = Number.isFinite(durationSec) ? durationSec : 0;
  const d = Math.max(0.5, Math.min(safeDuration, 10 * 60)); // clamp to [0.5s, 10m]
  const sr = Math.max(8000, Math.min(sampleRate, 48000));

  const totalSamples = Math.max(1, Math.floor(d * sr));
  const pcm = new Int16Array(totalSamples);

  const twoPi = Math.PI * 2;
  const f1 = Math.max(30, Math.min(toneHz, sr / 2 - 200));
  const f2 = f1 * 2.01;
  const f3 = f1 * 3.03;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sr;

    // Slow-changing envelope to create visible “blocks” in the waveform.
    const env = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(twoPi * 0.35 * t));

    // Small fade-in/out to avoid clicks.
    const fade = clamp(Math.min(t / 0.02, (d - t) / 0.02), 0, 1);

    const harmonic =
      Math.sin(twoPi * f1 * t) * 0.9 +
      Math.sin(twoPi * f2 * t) * 0.35 +
      Math.sin(twoPi * f3 * t) * 0.18;

    const noise = (Math.random() * 2 - 1) * noiseAmplitude;
    const sample = clamp((harmonic * amplitude * env * fade) + noise, -1, 1);
    pcm[i] = Math.round(sample * 0x7fff);
  }

  // WAV header (PCM, mono, 16-bit)
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sr * blockAlign;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++, offset += 2) {
    view.setInt16(offset, pcm[i], true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}
