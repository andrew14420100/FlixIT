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

  const activeIndex = useMemo(() => {
    const path = location.pathname;
    if (path === "/" || path === "/browse") return 0;
    if (path === "/cinema" || path.startsWith("/cinema/") || path.startsWith("/browse/movie/")) return 1;
    if (path === "/serie" || path.startsWith("/serie/") || path.startsWith("/browse/tv/")) return 2;
    if (path === "/account" || path.startsWith("/account/")) return 4;
    return -1;
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobile || isWatch) return;
    const root = document.documentElement;
    root.classList.remove("flixit-mobile-route-pending");

    const stage = document.querySelector<HTMLElement>(".flixit-route-stage");
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
        { opacity: 0.72, transform: `translate3d(${10 * direction}px, 0, 0) scale(.995)` },
        { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
      ],
      {
        duration: 230,
        easing: "cubic-bezier(.16,1,.3,1)",
        fill: "both",
      }
    );
  }, [location.pathname, activeIndex, isMobile, isWatch]);

  if (!isMobile || isWatch) return null;

  const openSearch = () => {
    const container = document.querySelector<HTMLElement>('[data-testid="search-box"]');
    const trigger = container?.firstElementChild as HTMLElement | null;
    trigger?.click();
    window.setTimeout(
      () => document.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus(),
      60
    );
  };

  const navigateAnimated = (path: string) => {
    if (path === "__search__") {
      openSearch();
      return;
    }
    if (location.pathname === path) return;

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
