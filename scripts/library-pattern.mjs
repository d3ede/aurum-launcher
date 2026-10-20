import { writeFileSync } from "node:fs";

// A complete curve shifts by exactly one tile in both axes. Matching endpoint
// tangents make adjacent copies join smoothly, including at the tile corners.
// Extra cycles keep every path endpoint outside the visible tile.
const width = 1000;
const height = 520;
const paths = [];
for (let line = 0; line < 7; line++) {
  for (const copy of [-width, -width / 2, 0, width / 2]) {
    const startX = 320 + copy;
    const startY = line * 8;
    let d = `M${startX - width} ${startY - height}`;
    for (const cycle of [-1, 0, 1]) {
      const x = startX + cycle * width;
      const y = startY + cycle * height;
      d += `C${x + 80} ${y + 90} ${x + 90} ${y + 150} ${x + 380} ${y + 180}`;
      d += `C${x + 670} ${y + 210} ${x + 920} ${y + 430} ${x + width} ${y + height}`;
    }
    paths.push(`<path d="${d}"/>`);
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none"><g stroke="#94999F" stroke-width=".8">${paths.join("")}</g></svg>\n`;
writeFileSync(
  new URL("../src/assets/branding/library-pattern.svg", import.meta.url),
  svg,
);
