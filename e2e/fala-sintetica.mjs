// Entrada de áudio REPRODUZÍVEL para os testes de voz (mídia simulada, não é voz humana):
// "fala sintética" determinística — fundamental ~140 Hz com vibrato e harmônicos, sílabas
// a ~4,5 Hz com pausas curtas, nível médio de fala (≈ -20 dBFS RMS nas sílabas). Gerada por
// este script (sem gravação de terceiros), escrita como WAV PCM 16 bits 48 kHz mono.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function escreverFalaSintetica(path, segundos = 12) {
  const sr = 48000;
  const n = sr * segundos;
  const pcm = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f0 = 140 + 12 * Math.sin(2 * Math.PI * 5.2 * t) + 25 * Math.sin(2 * Math.PI * 0.37 * t);
    phase += (2 * Math.PI * f0) / sr;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(phase * h) / h ** 1.1;
    // sílabas: janela de ~180 ms a cada 222 ms; pausa de 0,5 s a cada 2,4 s (respiração)
    const syl = Math.sin(Math.PI * ((t * 4.5) % 1)) ** 2 * ((t * 4.5) % 1 < 0.8 ? 1 : 0);
    const breath = t % 2.4 > 1.9 ? 0 : 1;
    pcm[i] = Math.round(Math.max(-1, Math.min(1, v * 0.16 * syl * breath)) * 32767);
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  Buffer.from(pcm.buffer).copy(buf, 44);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  return path;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(escreverFalaSintetica(process.argv[2] ?? new URL('./out/fala-sintetica.wav', import.meta.url).pathname));
