import { useSyncExternalStore } from "react";

const changed = "aurum:motion-change";
export function animationsDisabled() {
  return document.documentElement.dataset.animations === "off";
}
export function reducedMotion() {
  return (
    animationsDisabled() ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
export function applyMotion(disabled: boolean) {
  document.documentElement.dataset.animations = disabled ? "off" : "on";
  if (disabled)
    document.getAnimations().forEach((animation) => animation.cancel());
  window.dispatchEvent(new Event(changed));
}
function subscribe(callback: () => void) {
  window.addEventListener(changed, callback);
  return () => window.removeEventListener(changed, callback);
}
export function useAnimationsDisabled() {
  return useSyncExternalStore(subscribe, animationsDisabled, () => false);
}
