import type { PointerEvent } from "react";

export function beginButtonHover(event: PointerEvent<HTMLButtonElement>) {
  const button = event.currentTarget;
  if (button.disabled) return;
  const bounds = button.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  button.style.setProperty("--hover-x", `${x}px`);
  button.style.setProperty("--hover-y", `${y}px`);
  button.style.setProperty(
    "--hover-diameter",
    // The solid center must reach every corner before the soft edge settles.
    `${(2 * Math.hypot(Math.max(x, bounds.width - x), Math.max(y, bounds.height - y))) / 0.62}px`,
  );
}
