// @ts-nocheck
import { useEffect } from "react";

/**
 * Single play silhouette used everywhere in FLIXIT.
 * Shape traced from the approved reference: vertical rounded left edge,
 * rounded top/bottom shoulders and a compact right-pointing tip.
 */
export const PLAY_GLYPH_PATH = "M8.18 4.55C7.35 4.06 6.3 4.66 6.3 5.63V18.37C6.3 19.34 7.35 19.94 8.18 19.45L19.45 12.79C20.29 12.29 20.29 11.71 19.45 11.21L8.18 4.55Z";

export function PlayGlyph({ size = 24, color = "currentColor", className = "", ...props }: any) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
      data-flixit-play-glyph="true"
      {...props}
    >
      <path d={PLAY_GLYPH_PATH} fill={color} />
    </svg>
  );
}

const PLAY_TEST_IDS = new Set([
  "PlayArrowIcon",
  "PlayArrowRoundedIcon",
  "PlayCircleIcon",
  "PlayCircleOutlineIcon",
]);

function looksLikePlayControl(svg: SVGSVGElement) {
  const testId = svg.getAttribute("data-testid") || "";
  if (PLAY_TEST_IDS.has(testId) || /^Play(?:Arrow|Circle)/i.test(testId)) return true;

  const button = svg.closest("button, a, [role='button']") as HTMLElement | null;
  if (!button) return false;
  const label = [
    button.getAttribute("aria-label"),
    button.getAttribute("title"),
    button.textContent,
  ].filter(Boolean).join(" ");
  return /(?:^|\s)(?:riproduci|riprendi|play)(?:\s|$)/i.test(label);
}

function normalizePlaySvg(svg: SVGSVGElement) {
  if (!looksLikePlayControl(svg)) return;
  const path = svg.querySelector("path");
  if (
    svg.getAttribute("data-flixit-play-glyph") === "true" &&
    path?.getAttribute("d") === PLAY_GLYPH_PATH
  ) return;

  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const nextPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  nextPath.setAttribute("d", PLAY_GLYPH_PATH);
  nextPath.setAttribute("fill", "currentColor");
  svg.appendChild(nextPath);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("data-flixit-play-glyph", "true");
  svg.setAttribute("aria-hidden", "true");
}

function scanPlayIcons(scope: ParentNode = document) {
  const nodes: SVGSVGElement[] = [];
  if (scope instanceof SVGSVGElement) nodes.push(scope);
  scope.querySelectorAll?.("svg").forEach((node: any) => nodes.push(node));
  nodes.forEach(normalizePlaySvg);
}

/**
 * MUI and the player render play icons from several components. This normalizer
 * guarantees that every play/resume control — desktop and mobile — uses the
 * approved FLIXIT play silhouette without having to maintain multiple icon
 * implementations.
 */
export function GlobalPlayGlyphNormalizer() {
  useEffect(() => {
    let raf = 0;
    const pending = new Set<ParentNode>();

    const flush = () => {
      raf = 0;
      const scopes = Array.from(pending);
      pending.clear();
      if (!scopes.length) scopes.push(document);
      scopes.forEach((scope) => scanPlayIcons(scope));
    };

    const schedule = (scope: ParentNode = document) => {
      pending.add(scope);
      if (!raf) raf = requestAnimationFrame(flush);
    };

    schedule(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          schedule(record.target as Element);
          continue;
        }
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) schedule(node);
        });
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "data-testid"],
    });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      pending.clear();
    };
  }, []);

  return null;
}

export default PlayGlyph;
