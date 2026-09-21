// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const DETAIL_RE = /^\/(?:detail|browse)\/(?:movie|tv)\/\d+(?:\/|$)/i;

function polishMobileLabel() {
  document.querySelectorAll<HTMLButtonElement>(".mobile-detail-more").forEach((button) => {
    if (String(button.textContent || "").trim() === "Altro") button.textContent = "Di più";
  });
}

function desktopOverviewCandidate() {
  const root = document.querySelector<HTMLElement>('[data-testid="detail-page-redesign"]');
  if (!root || window.matchMedia("(max-width:899px)").matches) return null;

  const candidates = Array.from(root.querySelectorAll<HTMLElement>(".MuiTypography-root"))
    .filter((node) => {
      const text = String(node.textContent || "").trim();
      if (text.length < 230) return false;
      if (node.closest("#episodes")) return false;
      if (node.closest("button")) return false;
      if (node.closest(".flixit-episode-actions")) return false;
      return true;
    });

  return candidates.sort((a, b) => String(b.textContent || "").length - String(a.textContent || "").length)[0] || null;
}

function ensureDesktopExpander() {
  const overview = desktopOverviewCandidate();
  if (!overview || overview.dataset.flixitDescriptionExpandable === "true") return;

  overview.dataset.flixitDescriptionExpandable = "true";
  overview.classList.add("flixit-detail-overview-runtime");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "flixit-detail-overview-toggle";
  button.textContent = "Di più";
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", () => {
    const expanded = overview.classList.toggle("is-expanded");
    button.textContent = expanded ? "Riduci" : "Di più";
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
  });
  overview.insertAdjacentElement("afterend", button);
}

export default function DetailDescriptionExpander() {
  const location = useLocation();

  useEffect(() => {
    if (!DETAIL_RE.test(location.pathname)) return;

    let raf = 0;
    const scan = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        polishMobileLabel();
        ensureDesktopExpander();
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [location.pathname]);

  return null;
}
