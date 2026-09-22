// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import MovieCreationOutlinedIcon from "@mui/icons-material/MovieCreationOutlined";
import LiveTvOutlinedIcon from "@mui/icons-material/LiveTvOutlined";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import LocalMoviesOutlinedIcon from "@mui/icons-material/LocalMoviesOutlined";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import UpcomingOutlinedIcon from "@mui/icons-material/UpcomingOutlined";
import BookmarkBorderRoundedIcon from "@mui/icons-material/BookmarkBorderRounded";
import AccountCircleOutlinedIcon from "@mui/icons-material/AccountCircleOutlined";

const MOBILE_QUERY = "(max-width:899px)";

function isActivePath(pathname: string, path: string) {
  if (path === "/browse") return pathname === "/" || pathname === "/browse";
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Poster URLs are now resolved by useArtworkBatch through the lightweight
 * backend batch API.  This runtime only adds the presentation classes that the
 * mobile CSS needs; it deliberately never downloads/parses the 6+ MB catalogue.
 */
function markMobileCards(scope: ParentNode = document) {
  const visit = (selector: string, callback: (node: HTMLElement) => void) => {
    const root = scope as HTMLElement;
    if (root?.matches?.(selector)) callback(root);
    scope.querySelectorAll?.<HTMLElement>(selector).forEach(callback);
  };

  visit(".netflix-standard-card-root", (node) => {
    node.classList.add("flixit-mobile-poster");
    const img = node.querySelector<HTMLImageElement>("img");
    if (img) {
      img.loading = "lazy";
      img.decoding = "async";
    }
  });

  visit('[data-testid^="horizontal-card-"]', (node) => {
    node.classList.add("flixit-mobile-list-poster");
    const img = node.querySelector<HTMLImageElement>("img");
    if (img) {
      img.loading = "lazy";
      img.decoding = "async";
    }
  });
}

export default function MobileSCExperience() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const navigate = useNavigate();
  const isWatch = location.pathname.startsWith("/watch");
  const isHome = location.pathname === "/" || location.pathname === "/browse";
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (!isMobile) {
      root.classList.remove("flixit-mobile-sc", "flixit-home-reference");
      return;
    }
    root.classList.add("flixit-mobile-sc");
    root.classList.toggle("flixit-home-reference", isHome);
    return () => root.classList.remove("flixit-mobile-sc", "flixit-home-reference");
  }, [isMobile, isHome]);

  useEffect(() => {
    if (!isMobile) return;
    ["https://cdn.streamingunity-premium.to", "https://cdn.streamingunity.win"].forEach((href) => {
      if (document.head.querySelector(`link[data-flixit-preconnect="${href}"]`)) return;
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = href;
      link.crossOrigin = "anonymous";
      link.dataset.flixitPreconnect = href;
      document.head.appendChild(link);
    });
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    let raf = 0;
    const pending = new Set<ParentNode>();
    const flush = () => {
      raf = 0;
      const scopes = Array.from(pending);
      pending.clear();
      (scopes.length ? scopes : [document]).forEach(markMobileCards);
    };
    const schedule = (scope: ParentNode = document) => {
      pending.add(scope);
      if (!raf) raf = requestAnimationFrame(flush);
    };

    schedule(document);
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) schedule(node as HTMLElement);
        });
      });
    });
    observer.observe(document.body, { subtree: true, childList: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      pending.clear();
    };
  }, [isMobile, location.pathname]);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const drawerItems = useMemo(
    () => [
      { label: "Home", path: "/browse", icon: HomeRoundedIcon },
      { label: "Serie TV", path: "/serie", icon: LiveTvOutlinedIcon },
      { label: "Cinema", path: "/cinema", icon: GridViewRoundedIcon },
      { label: "Catalogo", path: "/archivio", icon: CategoryOutlinedIcon },
      { label: "Prime Visioni", path: "/p/prime-visioni", icon: LocalMoviesOutlinedIcon },
      { label: "Cinema d'Autore", path: "/p/cinema-d-autore", icon: MovieCreationOutlinedIcon },
      { label: "In arrivo", path: "/in-arrivo", icon: UpcomingOutlinedIcon },
      { label: "La mia lista", path: "/my-list", icon: BookmarkBorderRoundedIcon },
      { label: "Account", path: "/account", icon: AccountCircleOutlinedIcon },
    ],
    []
  );

  if (!isMobile || isWatch || isHome) return null;

  return (
    <>
      <Box
        component="button"
        type="button"
        className="flixit-sc-navbar-toggler"
        aria-label="Apri menu"
        onClick={() => setDrawerOpen(true)}
      >
        <MenuRoundedIcon />
      </Box>

      {drawerOpen && (
        <Box className="flixit-mobile-menu-backdrop" onClick={() => setDrawerOpen(false)}>
          <Box
            className="flixit-mobile-menu-panel"
            onClick={(event) => event.stopPropagation()}
            data-testid="mobile-navigation-drawer"
          >
            <Box className="flixit-mobile-menu-head">
              <Box className="flixit-mobile-menu-logo"><span>FLIX</span><b>IT</b></Box>
              <Box component="button" type="button" aria-label="Chiudi menu" onClick={() => setDrawerOpen(false)}>
                <CloseRoundedIcon />
              </Box>
            </Box>

            <Box className="flixit-mobile-menu-list">
              {drawerItems.map(({ label, path, icon: Icon }) => (
                <Box
                  key={label}
                  component="button"
                  type="button"
                  onClick={() => { setDrawerOpen(false); navigate(path); }}
                  className={isActivePath(location.pathname, path) ? "is-active" : ""}
                >
                  <Icon />
                  <span>{label}</span>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </>
  );
}
