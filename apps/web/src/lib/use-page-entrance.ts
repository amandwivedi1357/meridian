import { useLayoutEffect, useRef } from "react";

// Keep refresh choreography separate from live updates and subsequent route visits.
const enteredPages = new Set<string>();

export type EntranceSequence = readonly (readonly [string, number, string])[];

export function usePageEntrance<T extends HTMLElement>(
  page: string,
  sequence: EntranceSequence,
  enabled = true
) {
  const root = useRef<T>(null);
  const shouldEnter = useRef(!enteredPages.has(page));

  useLayoutEffect(() => {
    const node = root.current;
    if (!enabled || !node || !shouldEnter.current) return;
    enteredPages.add(page);
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const easing = getComputedStyle(node).getPropertyValue("--ease-out").trim();
    const animations: Animation[] = [];
    const compact = window.matchMedia("(max-width: 1100px)").matches;
    for (const [selector, delay, transform] of sequence) {
      const element = node.querySelector<HTMLElement>(selector);
      if (!element || typeof element.animate !== "function") continue;
      const entranceTransform =
        compact && transform.startsWith("translateX") ? "translateY(24px)" : transform;
      animations.push(
        element.animate(
          [
            {
              opacity: preference.matches ? 0.65 : 0,
              transform: preference.matches ? "none" : entranceTransform
            },
            { opacity: 1, transform: "none" }
          ],
          {
            duration: preference.matches ? 125 : 300,
            delay: preference.matches ? 0 : delay,
            easing,
            fill: "backwards"
          }
        )
      );
    }
    // Settle moving targets as soon as someone wants to use the page.
    const settle = () => animations.forEach((animation) => animation.cancel());
    const onPreferenceChange = () => {
      if (preference.matches) settle();
    };
    node.addEventListener("pointerdown", settle, { capture: true, once: true });
    node.addEventListener("focusin", settle, { once: true });
    preference.addEventListener("change", onPreferenceChange);
    window.addEventListener("resize", settle, { once: true });
    return () => {
      settle();
      node.removeEventListener("pointerdown", settle, true);
      node.removeEventListener("focusin", settle);
      preference.removeEventListener("change", onPreferenceChange);
      window.removeEventListener("resize", settle);
    };
  }, [page, sequence, enabled]);
  return root;
}
