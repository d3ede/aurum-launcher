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
    "--hover-radius",
    `${Math.hypot(Math.max(x, bounds.width - x), Math.max(y, bounds.height - y))}px`,
  );
}
