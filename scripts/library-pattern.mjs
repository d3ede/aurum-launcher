import { writeFileSync } from "node:fs";

// A complete curve shifts by exactly one tile in both axes. Matching endpoint
// tangents make adjacent copies join smoothly, including at the tile corners.
// Extra cycles keep every path endpoint outside the visible tile.
const width = 1000;
const height = 520;
const paths = [];
for (let line = 0; line < 5; line++) {
  for (const copy of [-width, 0, width]) {
    const startX = 320 + copy;
    const startY = line * 22;
    let d = `M${startX - width} ${startY - height}`;
    for (const cycle of [-1, 0, 1]) {
      const x = startX + cycle * width;
      const y = startY + cycle * height;
      d += `C${x + 40} ${y + 100} ${x + 100} ${y + 220} ${x + 470} ${y + 230}`;
      d += `C${x + 840} ${y + 240} ${x + 960} ${y + 420} ${x + width} ${y + height}`;
    }
    paths.push(`<path d="${d}"/>`);
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none"><g stroke="#94999F" stroke-width=".8">${paths.join("")}</g></svg>\n`;
writeFileSync(
  new URL("../src/assets/branding/library-pattern.svg", import.meta.url),
  svg,
);
