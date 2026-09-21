// @ts-nocheck
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const DETAIL_TV_RE = /^\/(?:detail|browse)\/tv\/\d+(?:\/|$)/i;

function syncPendingActions() {
  document.querySelectorAll<HTMLElement>(".mobile-detail-episode").forEach((row) => {
    const pending = row.classList.contains("is-italian-pending");
    const actions = row.nextElementSibling as HTMLElement | null;
    if (!actions?.classList.contains("flixit-episode-actions")) return;
    actions.classList.toggle("is-italian-pending", pending);
    actions.setAttribute("aria-disabled", pending ? "true" : "false");
    actions.style.opacity = pending ? "0.42" : "";
    actions.style.pointerEvents = pending ? "none" : "";
    actions.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = pending;
      button.setAttribute("aria-disabled", pending ? "true" : "false");
    });
  });

  document.querySelectorAll<HTMLElement>("#episodes .flixit-desktop-episode-row").forEach((row) => {
    const pending = row.classList.contains("is-italian-pending");
    row.querySelectorAll<HTMLElement>(".flixit-episode-actions").forEach((actions) => {
      actions.classList.toggle("is-italian-pending", pending);
      actions.setAttribute("aria-disabled", pending ? "true" : "false");
      actions.style.opacity = pending ? "0.42" : "";
      actions.style.pointerEvents = pending ? "none" : "";
      actions.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
        button.disabled = pending;
        button.setAttribute("aria-disabled", pending ? "true" : "false");
      });
    });
  });
}

export default function ItalianEpisodeActionGuard() {
  const location = useLocation();

  useEffect(() => {
    if (!DETAIL_TV_RE.test(location.pathname)) return;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncPendingActions();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "aria-disabled"],
    });

    const blockPending = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const pendingActions = target?.closest?.(".flixit-episode-actions.is-italian-pending");
      const pendingRow = target?.closest?.(".mobile-detail-episode.is-italian-pending, #episodes .flixit-desktop-episode-row.is-italian-pending");
      if (!pendingActions && !pendingRow) return;
      event.preventDefault();
      event.stopPropagation();
      (event as any).stopImmediatePropagation?.();
    };

    document.addEventListener("click", blockPending, true);
    document.addEventListener("pointerdown", blockPending, true);
    schedule();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("click", blockPending, true);
      document.removeEventListener("pointerdown", blockPending, true);
    };
  }, [location.pathname]);

  return null;
}
