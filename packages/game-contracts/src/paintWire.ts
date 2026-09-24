/**
 * Codificação binária da tinta. A autoridade é o servidor; o cliente apenas
 * reconstrói a propriedade lógica a partir de snapshot + deltas versionados.
 *
 * Valores de célula no fio: 0 = neutro, 1 = equipe 0, 2 = equipe 1.
 */

export const PAINT_WIRE_VERSION = 1;
export const PAINT_MSG_SNAPSHOT = 1;
export const PAINT_MSG_DELTA = 2;
/** Limite de células por mensagem de delta; excedentes vão na próxima. */
export const PAINT_DELTA_MAX_CELLS = 12000;

export interface PaintSnapshotWire {
  contextTag: number;
  roundId: number;
  paintSeq: number;
  /** Valores por célula (0,1,2). */
  cells: Uint8Array;
  /** Versões por chunk no instante do corte. */
  chunkVersions: Uint32Array;
}

export interface PaintChunkDelta {
  chunkId: number;
  baseVersion: number;
  newVersion: number;
  /** Pares [índice local da célula no chunk, valor]. */
  cells: Array<[number, number]>;
}

export interface PaintDeltaWire {
  contextTag: number;
  roundId: number;
  fromSeq: number;
  toSeq: number;
  chunks: PaintChunkDelta[];
}

export function ownerToWire(owner: number): number {
  return owner + 1;
}
export function wireToOwner(v: number): -1 | 0 | 1 {
  return (v - 1) as -1 | 0 | 1;
}

/** Hash FNV-1a de 32 bits — identifica contexto (partida + mapa), não é segurança. */
export function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function paintContextTag(matchId: string, mapHash: string): number {
  return fnv1a32(`${matchId}|${mapHash}`);
}

class Writer {
  buf: Uint8Array;
  view: DataView;
  pos = 0;
  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }
  ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf.subarray(0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.buf[this.pos++] = v & 0xff;
  }
  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }
  u32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }
  varint(v: number) {
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.u8(v);
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

class Reader {
  view: DataView;
  pos = 0;
  constructor(public buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  check(n: number) {
    if (this.pos + n > this.buf.length) throw new Error('paint wire: leitura além do fim');
  }
  u8() {
    this.check(1);
    return this.buf[this.pos++];
  }
  u16() {
    this.check(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32() {
    this.check(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  varint() {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 6; i++) {
      const b = this.u8();
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return result;
      mul *= 128;
    }
    throw new Error('paint wire: varint inválido');
  }
}

export function encodePaintSnapshot(s: PaintSnapshotWire): Uint8Array {
  const w = new Writer(4096);
  w.u8(PAINT_MSG_SNAPSHOT);
  w.u8(PAINT_WIRE_VERSION);
  w.u32(s.contextTag);
  w.u32(s.roundId);
  w.u32(s.paintSeq);
  w.u32(s.cells.length);
  w.u32(s.chunkVersions.length);
  for (let i = 0; i < s.chunkVersions.length; i++) w.varint(s.chunkVersions[i]);
  // RLE
  let i = 0;
  const n = s.cells.length;
  while (i < n) {
    const v = s.cells[i];
    let j = i + 1;
    while (j < n && s.cells[j] === v) j++;
    w.u8(v);
    w.varint(j - i);
    i = j;
  }
  return w.done();
}

export function decodePaintSnapshot(bytes: Uint8Array): PaintSnapshotWire {
  const r = new Reader(bytes);
  if (r.u8() !== PAINT_MSG_SNAPSHOT) throw new Error('paint wire: tipo inesperado');
  if (r.u8() !== PAINT_WIRE_VERSION) throw new Error('paint wire: versão incompatível');
  const contextTag = r.u32();
  const roundId = r.u32();
  const paintSeq = r.u32();
  const total = r.u32();
  if (total > 4_000_000) throw new Error('paint wire: total de células excessivo');
  const nChunks = r.u32();
  if (nChunks > 200_000) throw new Error('paint wire: chunks excessivos');
  const chunkVersions = new Uint32Array(nChunks);
  for (let i = 0; i < nChunks; i++) chunkVersions[i] = r.varint();
  const cells = new Uint8Array(total);
  let i = 0;
  while (i < total) {
    const v = r.u8();
    const len = r.varint();
    if (v > 2 || len <= 0 || i + len > total) throw new Error('paint wire: RLE inválido');
    cells.fill(v, i, i + len);
    i += len;
  }
  return { contextTag, roundId, paintSeq, cells, chunkVersions };
}

export function encodePaintDelta(d: PaintDeltaWire): Uint8Array {
  const w = new Writer(256 + d.chunks.length * 16);
  w.u8(PAINT_MSG_DELTA);
  w.u8(PAINT_WIRE_VERSION);
  w.u32(d.contextTag);
  w.u32(d.roundId);
  w.u32(d.fromSeq);
  w.u32(d.toSeq);
  w.u16(d.chunks.length);
  for (const c of d.chunks) {
    w.u16(c.chunkId);
    w.u32(c.baseVersion);
    w.u32(c.newVersion);
    w.u16(c.cells.length);
    for (const [idx, v] of c.cells) {
      w.u8(idx);
      w.u8(v);
    }
  }
  return w.done();
}

export function decodePaintDelta(bytes: Uint8Array): PaintDeltaWire {
  const r = new Reader(bytes);
  if (r.u8() !== PAINT_MSG_DELTA) throw new Error('paint wire: tipo inesperado');
  if (r.u8() !== PAINT_WIRE_VERSION) throw new Error('paint wire: versão incompatível');
  const contextTag = r.u32();
  const roundId = r.u32();
  const fromSeq = r.u32();
  const toSeq = r.u32();
  const n = r.u16();
  const chunks: PaintChunkDelta[] = [];
  for (let i = 0; i < n; i++) {
    const chunkId = r.u16();
    const baseVersion = r.u32();
    const newVersion = r.u32();
    const count = r.u16();
    const cells: Array<[number, number]> = new Array(count);
    for (let k = 0; k < count; k++) {
      const idx = r.u8();
      const v = r.u8();
      if (v > 2) throw new Error('paint wire: valor inválido');
      cells[k] = [idx, v];
    }
    chunks.push({ chunkId, baseVersion, newVersion, cells });
  }
  return { contextTag, roundId, fromSeq, toSeq, chunks };
}
