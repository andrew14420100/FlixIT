// @ts-nocheck
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import MovieCreationOutlinedIcon from "@mui/icons-material/MovieCreationOutlined";
import LiveTvOutlinedIcon from "@mui/icons-material/LiveTvOutlined";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import AccountCircleOutlinedIcon from "@mui/icons-material/AccountCircleOutlined";

const MOBILE_QUERY = "(max-width:899px)";
const prefetched = new Set<string>();

function prefetchPath(path: string) {
  if (!path || path === "__search__" || prefetched.has(path)) return;
  prefetched.add(path);
  const run = () => {
    if (path === "/browse") import("src/pages/HomePage").catch(() => prefetched.delete(path));
    else if (path === "/cinema") import("src/pages/CinemaHubPage").catch(() => prefetched.delete(path));
    else if (path === "/serie") import("src/pages/SerieHubPage").catch(() => prefetched.delete(path));
    else if (path === "/account") import("src/pages/AccountPage").catch(() => prefetched.delete(path));
  };
  if ((window as any).requestIdleCallback) {
    (window as any).requestIdleCallback(run, { timeout: 900 });
  } else {
    window.setTimeout(run, 0);
  }
}

export default function MobileGlobalBottomNav() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const navigate = useNavigate();
  const isWatch = location.pathname.startsWith("/watch");
  const previousIndexRef = useRef(0);

  const items = useMemo(
    () => [
      { label: "Home", path: "/browse", icon: HomeRoundedIcon },
      { label: "Cinema", path: "/cinema", icon: MovieCreationOutlinedIcon },
      { label: "Serie TV", path: "/serie", icon: LiveTvOutlinedIcon },
      { label: "Cerca", path: "__search__", icon: SearchRoundedIcon },
      { label: "Account", path: "/account", icon: AccountCircleOutlinedIcon },
    ],
    []
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("flixit-global-bottom-nav-visible", !!isMobile && !isWatch);
    return () => root.classList.remove("flixit-global-bottom-nav-visible");
  }, [isMobile, isWatch]);

  useEffect(() => {
    if (!isMobile || isWatch) return;
    // Once the first screen is stable, warm the tiny route chunks behind the
    // bottom navigation. A tap then swaps screens without waiting for a chunk.
    const timer = window.setTimeout(() => {
      items.forEach((item) => prefetchPath(item.path));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [isMobile, isWatch, items]);

  const activeIndex = useMemo(() => {
    const path = location.pathname;
    if (path === "/" || path === "/browse") return 0;
    if (
      path === "/cinema" ||
      path.startsWith("/cinema/") ||
      path.startsWith("/browse/movie/") ||
      path.startsWith("/detail/movie/")
    ) return 1;
    if (
      path === "/serie" ||
      path.startsWith("/serie/") ||
      path.startsWith("/browse/tv/") ||
      path.startsWith("/detail/tv/")
    ) return 2;
    if (path === "/account" || path.startsWith("/account/")) return 4;
    return -1;
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobile || isWatch) return;
    const root = document.documentElement;
    root.classList.remove("flixit-mobile-route-pending");

    const stage = document.querySelector<HTMLElement>(".flixit-route-stage") || document.querySelector<HTMLElement>(".mobile-detail-v2");
    if (!stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      previousIndexRef.current = activeIndex >= 0 ? activeIndex : previousIndexRef.current;
      return;
    }

    const previous = previousIndexRef.current;
    const current = activeIndex >= 0 ? activeIndex : previous;
    const direction = current >= previous ? 1 : -1;
    previousIndexRef.current = current;

    stage.getAnimations?.().forEach((animation) => animation.cancel());
    stage.animate(
      [
        { opacity: 0.82, transform: `translate3d(${8 * direction}px, 0, 0) scale(.997)` },
        { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
      ],
      {
        duration: 190,
        easing: "cubic-bezier(.16,1,.3,1)",
        fill: "both",
      }
    );
  }, [location.pathname, activeIndex, isMobile, isWatch]);

  // Chrome on iPhone moves the visual viewport when its bottom toolbar hides or
  // reappears. A fixed element normally snaps to the new viewport edge. We use a
  // FLIP compensation so the menu visually stays where it was, then glides to
  // Chrome's new resting position instead of jumping.
  useEffect(() => {
    if (!isMobile || isWatch || !window.visualViewport) return;

    const viewport = window.visualViewport;
    let lastTop: number | null = null;
    let raf = 0;
    let settleTimer: number | null = null;

    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const nav = document.querySelector<HTMLElement>('[data-testid="global-mobile-bottom-nav"]');
        if (!nav) return;

        nav.getAnimations?.().forEach((animation: Animation) => {
          if ((animation as any).__flixitBrowserChromeMotion) animation.cancel();
        });

        const top = nav.getBoundingClientRect().top;
        if (lastTop == null) {
          lastTop = top;
          return;
        }

        const delta = lastTop - top;
        lastTop = top;
        if (Math.abs(delta) < 1.5 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        const animation = nav.animate(
          [
            { transform: `translate3d(0, ${delta}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: 280,
            easing: "cubic-bezier(.22,1,.36,1)",
            fill: "both",
          }
        );
        (animation as any).__flixitBrowserChromeMotion = true;

        if (settleTimer) window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          lastTop = nav.getBoundingClientRect().top;
        }, 320);
      });
    };

    const reset = () => {
      lastTop = null;
      measure();
    };

    measure();
    viewport.addEventListener("resize", measure, { passive: true });
    viewport.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("orientationchange", reset, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      if (settleTimer) window.clearTimeout(settleTimer);
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
      window.removeEventListener("orientationchange", reset);
    };
  }, [isMobile, isWatch]);

  if (!isMobile || isWatch) return null;

  const openSearch = () => {
    // SearchBox exposes this event specifically for mobile. Dispatching it is
    // robust even when the header layout changes; clicking firstElementChild was
    // a brittle DOM dependency and occasionally failed after lazy navigation.
    window.dispatchEvent(new CustomEvent("flixit-open-search"));
    window.setTimeout(
      () => document.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus(),
      50
    );
  };

  const navigateAnimated = (path: string) => {
    if (path === "__search__") {
      openSearch();
      return;
    }
    if (location.pathname === path) return;

    prefetchPath(path);
    document.documentElement.classList.add("flixit-mobile-route-pending");
    navigate(path);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  return (
    <Box
      className="flixit-mobile-bottom-nav flixit-global-bottom-nav"
      data-testid="global-mobile-bottom-nav"
      style={{ "--flixit-active-index": Math.max(activeIndex, 0) } as any}
    >
      <span
        className={`flixit-mobile-nav-indicator ${activeIndex < 0 ? "is-hidden" : ""}`}
        aria-hidden="true"
      />
      {items.map((item, index) => {
        const Icon = item.icon;
        const active = index === activeIndex;
        return (
          <Box
            key={item.label}
            component="button"
            type="button"
            aria-label={item.label}
            className={active ? "is-active" : ""}
            onPointerDown={() => prefetchPath(item.path)}
            onFocus={() => prefetchPath(item.path)}
            onClick={() => navigateAnimated(item.path)}
          >
            <span className="flixit-mobile-nav-icon-wrap">
              <Icon />
            </span>
            <span className="flixit-mobile-nav-label">{item.label}</span>
          </Box>
        );
      })}
    </Box>
  );
}
