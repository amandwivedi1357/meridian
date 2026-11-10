import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ThemeToggle } from "./ThemeToggle.js";
import { pages, type PageId } from "../../app/navigation.js";
import "./navigation-rail.css";

export function NavigationRail({ view }: { view: PageId }) {
  const [tooltip, setTooltip] = useState<{ label: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const hide = () => setTooltip(null);
    window.addEventListener("resize", hide);
    return () => window.removeEventListener("resize", hide);
  }, []);
  function showTooltip(target: HTMLAnchorElement, label: string, pointer = false) {
    if (pointer && !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const bounds = target.getBoundingClientRect();
    setTooltip({
      label,
      x: (target.closest("nav")?.getBoundingClientRect().right ?? bounds.right) + 8,
      y: bounds.top + bounds.height / 2
    });
  }
  return (
    <nav className="navigation-rail" aria-label="Primary">
      <span className="rail-brand brand-mark" aria-hidden="true">
        M
      </span>
      <div className="navigation-links" onScroll={() => setTooltip(null)}>
        {pages.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#/${id}`}
            aria-label={label}
            aria-current={view === id ? "page" : undefined}
            className={view === id ? "active" : ""}
            onMouseEnter={(event) => showTooltip(event.currentTarget, label, true)}
            onMouseLeave={() => setTooltip(null)}
            onFocus={(event) => showTooltip(event.currentTarget, label)}
            onBlur={() => setTooltip(null)}
            onClick={() => setTooltip(null)}
          >
            <Icon size={20} strokeWidth={1.7} />
          </a>
        ))}
      </div>
      <ThemeToggle />
      {tooltip &&
        createPortal(
          <span
            className="rail-tooltip-portal"
            aria-hidden="true"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.label}
          </span>,
          document.body
        )}
    </nav>
  );
}
