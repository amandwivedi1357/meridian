import { useEffect, useRef, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { getTheme, setTheme, useTheme } from "../../lib/theme.js";
import "./theme-toggle.css";

type ThemeTransition = {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition: () => void;
};
type TransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ThemeTransition;
};

export function ThemeToggle() {
  const theme = useTheme();
  const busy = useRef(false);
  const active = useRef<ThemeTransition>();
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const settle = () => {
      if (preference.matches) active.current?.skipTransition();
    };
    preference.addEventListener("change", settle);
    return () => {
      preference.removeEventListener("change", settle);
      active.current?.skipTransition();
    };
  }, []);

  async function toggle(event: MouseEvent<HTMLButtonElement>) {
    if (busy.current) return;
    const next = getTheme() === "light" ? "dark" : "light";
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const start = (document as TransitionDocument).startViewTransition;
    if (!start || preference.matches || event.detail === 0 || document.fullscreenElement) {
      setTheme(next);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2,
      y = bounds.top + bounds.height / 2;
    const radius = Math.ceil(Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)));
    busy.current = true;
    setSwitching(true);
    document.documentElement.dataset.themeTransition = "active";
    try {
      const transition = start.call(document, () => {
        flushSync(() => setTheme(next));
        // flushSync commits both the page palette and chart effects before the new snapshot.
      });
      active.current = transition;
      const finished = transition.finished.catch(() => {});
      await transition.ready;
      const animation = document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`]
        },
        {
          duration: 650,
          easing: "cubic-bezier(0.77, 0, 0.175, 1)",
          pseudoElement: "::view-transition-new(root)",
          fill: "both"
        }
      );
      const settle = () => {
        animation.finish();
        transition.skipTransition();
      };
      const resize = () => settle();
      window.addEventListener("resize", resize, { once: true });
      try {
        await finished;
      } finally {
        window.removeEventListener("resize", resize);
        animation.cancel();
      }
    } catch {
      active.current?.skipTransition();
      if (getTheme() !== next) setTheme(next);
    } finally {
      active.current = undefined;
      delete document.documentElement.dataset.themeTransition;
      busy.current = false;
      setSwitching(false);
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={(event) => void toggle(event)}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      aria-pressed={theme === "dark"}
      aria-busy={switching}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? (
        <Moon size={19} strokeWidth={1.7} />
      ) : (
        <Sun size={19} strokeWidth={1.7} />
      )}
    </button>
  );
}
