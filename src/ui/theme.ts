export type Theme = "dark" | "light";

const STORAGE_KEY = "reader.theme";

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the theme still applies for this session.
  }
}

export function toggleTheme(): Theme {
  const next: Theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}
