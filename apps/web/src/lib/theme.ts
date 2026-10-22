import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const media = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();
const systemTheme = (): Theme => (media.matches ? "dark" : "light");

function storedTheme() {
  try {
    return localStorage.getItem("theme") as Theme | null;
  } catch {
    return null;
  }
}

const currentTheme = () => storedTheme() ?? systemTheme();

function apply() {
  document.documentElement.classList.toggle("dark", currentTheme() === "dark");
  for (const listener of listeners) listener();
}

export function setTheme(theme: Theme) {
  try {
    if (theme === systemTheme()) localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {}
  apply();
}

export function useTheme() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, currentTheme);
}

media.addEventListener("change", apply);
apply();
