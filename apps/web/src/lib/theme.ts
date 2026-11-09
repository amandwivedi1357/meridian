import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const storageKey = "meridian-theme";
const listeners = new Set<() => void>();
let theme: Theme = "light";
try {
  theme = localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
} catch {
  /* Storage may be unavailable. */
}
document.documentElement.dataset.theme = theme;

export function getTheme() {
  return theme;
}
export function setTheme(next: Theme) {
  theme = next;
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    /* Keep an in-memory preference. */
  }
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
window.addEventListener("storage", (event) => {
  if (event.key === storageKey) {
    theme = event.newValue === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    listeners.forEach((listener) => listener());
  }
});
export function useTheme() {
  return useSyncExternalStore(subscribe, getTheme);
}
