// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const DETAIL_RE = /^\/(?:detail|browse)\/(?:movie|tv)\/\d+(?:\/|$)/i;

function findResumeCard() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("p, span, div, h1, h2, h3"));
  const label = nodes.find((node) => node.children.length === 0 && String(node.textContent || "").trim() === "Continua da dove hai interrotto");
  if (!label) return null;

  let current: HTMLElement | null = label.parentElement;
  while (current && current !== document.body) {
    if (current.querySelector("img") && current.querySelector("button")) return current;
    current = current.parentElement;
  }
  return null;
}

function removeArtworkPlayOverlay() {
  const card = findResumeCard();
  if (!card) return;
  const image = card.querySelector<HTMLImageElement>("img");
  const frame = image?.parentElement;
  if (!image || !frame || frame.dataset.flixitResumeArtworkClean === "true") return;

  Array.from(frame.children).forEach((child) => {
    if (child === image) return;
    const element = child as HTMLElement;
    // Only remove the visual play overlay that is layered directly on the
    // artwork. The real Resume button elsewhere in the card stays untouched.
    if (element.querySelector("svg") || element.getAttribute("role") === "button") {
      element.style.setProperty("display", "none", "important");
      element.setAttribute("aria-hidden", "true");
    }
  });
  frame.dataset.flixitResumeArtworkClean = "true";
}

export default function DetailResumeCardPolish() {
  const location = useLocation();

  useEffect(() => {
    if (!DETAIL_RE.test(location.pathname)) return;
    let frame = 0;
    const scan = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        removeArtworkPlayOverlay();
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { subtree: true, childList: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [location.pathname]);

  return null;
}
