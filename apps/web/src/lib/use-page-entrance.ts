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
    // Freeze under the pointer until its click is delivered; moving on pointer-down can swallow taps.
    let pointerActive = false;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      pointerActive = false;
      clearTimeout(releaseTimer);
      animations.forEach((animation) => animation.cancel());
    };
    const holdPointer = () => {
      pointerActive = true;
      animations.forEach((animation) => {
        if (animation.playState === "running") animation.pause();
      });
    };
    const releasePointer = () => {
      if (pointerActive) releaseTimer = setTimeout(settle, 0);
    };
    const settleKeyboardFocus = () => {
      if (!pointerActive) settle();
    };
    const onPreferenceChange = () => {
      if (preference.matches) settle();
    };
    node.addEventListener("pointerdown", holdPointer, { capture: true, once: true });
    node.addEventListener("click", settle, { once: true });
    node.addEventListener("focusin", settleKeyboardFocus);
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", settle);
    window.addEventListener("blur", settle);
    preference.addEventListener("change", onPreferenceChange);
    window.addEventListener("resize", settle, { once: true });
    return () => {
      settle();
      node.removeEventListener("pointerdown", holdPointer, true);
      node.removeEventListener("click", settle);
      node.removeEventListener("focusin", settleKeyboardFocus);
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", settle);
      window.removeEventListener("blur", settle);
      preference.removeEventListener("change", onPreferenceChange);
      window.removeEventListener("resize", settle);
    };
  }, [page, sequence, enabled]);
  return root;
}
