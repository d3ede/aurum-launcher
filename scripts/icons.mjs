import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
const size = 128,
  raw = Buffer.alloc((size * 4 + 1) * size);
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const n of b) {
    c ^= n;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (name, b) => {
  const n = Buffer.from(name),
    o = Buffer.alloc(b.length + 12);
  o.writeUInt32BE(b.length);
  n.copy(o, 4);
  b.copy(o, 8);
  o.writeUInt32BE(crc32(Buffer.concat([n, b])), b.length + 8);
  return o;
};
const distance = (x, y, x1, y1, x2, y2) => {
  const dx = x2 - x1,
    dy = y2 - y1,
    t = Math.max(
      0,
      Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)),
    );
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
};
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const inside =
      Math.hypot(
        Math.max(Math.abs(x - 63.5) - 40, 0),
        Math.max(Math.abs(y - 63.5) - 40, 0),
      ) <= 22;
    const mark =
      Math.min(
        distance(x, y, 36, 94, 64, 35),
        distance(x, y, 64, 35, 91, 94),
        distance(x, y, 49, 74, 79, 74),
        distance(x, y, 95, 28, 105, 28),
        distance(x, y, 100, 23, 100, 33),
      ) < 3.6;
    const pos = y * (size * 4 + 1) + 1 + x * 4;
    raw.set(
      mark
        ? [49, 61, 45, 255]
        : [237, Math.round(198 + y / 16), 111, inside ? 255 : 0],
      pos,
    );
  }
const header = Buffer.alloc(13);
header.writeUInt32BE(size);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
mkdirSync("src-tauri/icons", { recursive: true });
writeFileSync("src-tauri/icons/icon.png", png);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = size;
ico[7] = size;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
writeFileSync("src-tauri/icons/icon.ico", Buffer.concat([ico, png]));
