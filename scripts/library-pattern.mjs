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
// Closed, widely spaced contour islands add variety in the empty space between
// ribbons. They stay inside the tile, so they have no loose ends or edge seams.
for (const [cx, cy, radiusX, radiusY] of [
  [600, 390, 145, 76],
  [850, 110, 108, 60],
]) {
  for (let ring = 0; ring < 3; ring++) {
    const rx = radiusX - ring * 24;
    const ry = radiusY - ring * 14;
    const n = (value) => Math.round(value * 10) / 10;
    const d =
      `M${cx - rx} ${cy}` +
      `C${cx - rx} ${n(cy - ry * 0.65)} ${n(cx - rx * 0.55)} ${cy - ry} ${cx} ${cy - ry}` +
      `C${n(cx + rx * 0.65)} ${cy - ry} ${cx + rx} ${n(cy - ry * 0.45)} ${cx + rx} ${cy}` +
      `C${cx + rx} ${n(cy + ry * 0.65)} ${n(cx + rx * 0.45)} ${cy + ry} ${cx} ${cy + ry}` +
      `C${n(cx - rx * 0.65)} ${cy + ry} ${cx - rx} ${n(cy + ry * 0.45)} ${cx - rx} ${cy}Z`;
    paths.push(`<path d="${d}"/>`);
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none"><g stroke="#94999F" stroke-width=".8">${paths.join("")}</g></svg>\n`;
writeFileSync(
  new URL("../src/assets/branding/library-pattern.svg", import.meta.url),
  svg,
);
