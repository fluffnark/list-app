import React, { useEffect, useState } from "react";
import catalog from "./data/themes.json";
export type Theme = {
  id: string;
  name: string;
  group: string;
  source?: string;
  mode: string;
  colors: {
    background: string;
    foreground: string;
    accent: string;
    [key: string]: string | undefined;
  };
};
export const themes: Theme[] = [
  {
    id: "listflow",
    name: "ListFlow",
    group: "Featured",
    mode: "dark",
    colors: { background: "#111214", foreground: "#e7e7eb", accent: "#9690ff" },
  },
  ...catalog,
];
const key = "listflow-theme";
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function mix(a: string, b: string, amount: number) {
  const x = rgb(a),
    y = rgb(b);
  return (
    "#" +
    x
      .map((v, i) =>
        Math.round(v + (y[i] - v) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function luminance(hex: string) {
  return rgb(hex)
    .map((x) => {
      const c = x / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (x + 0.05) / (y + 0.05);
}
export function themeTokens(theme: Theme) {
  const c = theme.colors,
    bg = c.background,
    light = theme.mode === "light";
  const extreme = light ? "#000000" : "#ffffff";
  const surface = mix(bg, extreme, 0.035),
    hover = mix(bg, extreme, 0.07);
  const readable = (color: string) => {
    for (let i = 0; i <= 100; i++) {
      const value = mix(color, extreme, i / 100);
      if ([bg, surface, hover].every((b) => contrast(value, b) >= 4.5))
        return value;
    }
    return extreme;
  };
  const fg = readable(c.foreground),
    accent = c.accent;
  return {
    bg,
    panel: surface,
    sidebar: mix(bg, light ? "#ffffff" : "#000000", 0.12),
    "bg-deep": mix(bg, light ? "#ffffff" : "#000000", 0.18),
    surface,
    "surface-hover": hover,
    fg,
    muted: readable(mix(bg, fg, 0.6)),
    subtle: readable(mix(bg, fg, 0.5)),
    line: mix(bg, fg, 0.25),
    selection: mix(bg, accent, 0.22),
    accent,
    purple: readable(accent),
    "accent-text": readable(accent),
    "accent-soft": mix(bg, accent, 0.13),
    "on-accent":
      contrast(accent, "#000000") > contrast(accent, "#ffffff")
        ? "#000000"
        : "#ffffff",
    danger: readable(c.red || "#e05c76"),
    warning: readable(c.yellow || "#c89745"),
    success: readable(c.green || "#5ca981"),
    info: readable(c.blue || accent),
    "success-soft": mix(bg, c.green || "#5ca981", 0.12),
    "warning-soft": mix(bg, c.yellow || "#c89745", 0.12),
  };
}
export function savedTheme() {
  try {
    return themes.find((t) => t.id === localStorage.getItem(key)) || themes[0];
  } catch {
    return themes[0];
  }
}
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [token, value] of Object.entries(themeTokens(theme))) {
    if (theme.id === "listflow") root.style.removeProperty("--" + token);
    else root.style.setProperty("--" + token, value);
  }
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme.colors.background);
}
if (typeof document !== "undefined") applyTheme(savedTheme());
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === key || e.key === null) {
      applyTheme(savedTheme());
      window.dispatchEvent(new Event("listflow-theme-change"));
    }
  });
export function ThemePicker() {
  const [selected, setSelected] = useState(savedTheme);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("all");
  useEffect(() => {
    const update = () => setSelected(savedTheme());
    window.addEventListener("listflow-theme-change", update);
    return () => window.removeEventListener("listflow-theme-change", update);
  }, []);
  const visible = themes.filter(
    (t) =>
      (mode === "all" || t.mode === mode) &&
      `${t.name} ${t.group}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="settings-card appearance-card" aria-label="Appearance">
      <h3>Appearance</h3>
      <p>
        Theme: <strong>{selected.name}</strong> · Saved on this device
      </p>
      <div className="theme-controls">
        <input
          aria-label="Search themes"
          placeholder="Search themes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Theme mode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="all">Light & dark</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>
      <div className="theme-grid" role="radiogroup" aria-label="App theme">
        {visible.map((theme, index) => (
          <button
            key={theme.id}
            role="radio"
            aria-checked={selected.id === theme.id}
            aria-label={theme.name}
            className="theme-option"
            tabIndex={
              selected.id === theme.id ||
              (!visible.some((t) => t.id === selected.id) && index === 0)
                ? 0
                : -1
            }
            onKeyDown={(e) => {
              const delta = ["ArrowRight", "ArrowDown"].includes(e.key)
                ? 1
                : ["ArrowLeft", "ArrowUp"].includes(e.key)
                  ? -1
                  : 0;
              if (!delta && e.key !== "Home" && e.key !== "End") return;
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? visible.length - 1
                    : (index + delta + visible.length) % visible.length;
              const button =
                e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                  '[role="radio"]',
                )[next];
              button.focus();
              button.click();
            }}
            onClick={() => {
              try {
                localStorage.setItem(key, theme.id);
              } catch {
                /* The current session can still preview the theme. */
              }
              applyTheme(theme);
              setSelected(theme);
            }}
          >
            <span
              className="theme-swatches"
              aria-hidden="true"
              style={{ background: theme.colors.background }}
            >
              {[
                theme.colors.foreground,
                theme.colors.accent,
                theme.colors.green || theme.colors.accent,
                theme.colors.red || theme.colors.foreground,
              ].map((color, i) => (
                <i key={i} style={{ background: color }} />
              ))}
            </span>
            <span className="theme-option-name">{theme.name}</span>
            <small>
              {theme.group} · {theme.mode}
            </small>
          </button>
        ))}
      </div>
      {!visible.length && <p role="status">No themes match your search.</p>}
      <div className="theme-attribution">
        <span>{themes.length} bundled themes</span>
        {selected.source && (
          <a href={selected.source} target="_blank" rel="noopener noreferrer">
            Theme source ↗
          </a>
        )}
        <a
          href="https://omarchy.org/themes/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Omarchy community ↗
        </a>
      </div>
    </section>
  );
}
