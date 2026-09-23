// @ts-nocheck
import { lazy, Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import useMediaQuery from "@mui/material/useMediaQuery";

import LazyVideoPortalContainer from "src/components/LazyVideoPortalContainer";
import PortalProvider from "src/providers/PortalProvider";
import DetailModalProvider from "src/providers/DetailModalProvider";
import { MAIN_PATH } from "src/constant";
import { Footer, MainHeader } from "src/components/layouts";
import LazyAuthModalMount from "src/components/auth/LazyAuthModalMount";
import SessionGuards from "src/components/auth/SessionGuards";
import MobileGlobalBottomNav from "src/components/mobile/MobileGlobalBottomNav";
import ScCdnRecovery from "src/components/mobile/ScCdnRecovery";
import HomeHeroRuntimeFixes from "src/components/HomeHeroRuntimeFixes";
import NetflixHomeAmbientExact from "src/components/NetflixHomeAmbientExact";
import { GlobalPlayGlyphNormalizer } from "src/components/PlayGlyph";
import "src/components/mobile/mobile-sc-exact.css";
import "src/components/mobile/mobile-home-reference.css";
import "src/components/mobile/mobile-home-finish.css";
import "src/components/mobile/mobile-home-polish.css";
import "src/components/site-polish.css";
import "src/components/NetflixMotionOverrides.css";
import "src/components/ScRowAxis.css";
import "src/components/ScHomeLayoutFinal.css";
import "src/components/ScHomeContentGuard.css";
import "src/components/ScHomeViewportTuning.css";
import "src/components/ScHomeScreenshotExact.css";
import "src/components/ScHoverFreeze.css";
import "src/components/NetflixHeroFinal.css";
import "src/components/NetflixHeroSelections.css";
import "src/components/LogoVisibilityRecovery.css";

const MobileSCExperience = lazy(() => import("src/components/mobile/MobileSCExperience"));
const MobileSCExactAssets = lazy(() => import("src/components/mobile/MobileSCExactAssets"));
const MobileHomeReferenceRuntime = lazy(() => import("src/components/mobile/MobileHomeReferenceRuntime"));
const MobileHomeSectionRecovery = lazy(() => import("src/components/mobile/MobileHomeSectionRecovery"));
const WatchEpisodeAdvanceTracker = lazy(() => import("src/components/watch/WatchEpisodeAdvanceTracker"));

function isHomeRoute(pathname: string) {
  const raw = String(pathname || "/");
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  return (
    path === "/" ||
    path === "/browse" ||
    path === "/browse/genre/movie" ||
    path === "/browse/genre/tv" ||
    path === "/browse/latest" ||
    path === "/browse/trending"
  );
}

function isDetailRoute(pathname: string) {
  return /^\/(?:detail|browse)\/(?:movie|tv)\/\d+(?:\/|$)/i.test(pathname);
}

export default function MainLayout() {
  const location = useLocation();
  const isMobile = useMediaQuery("(max-width:899px)");
  const isHome = isHomeRoute(location.pathname);
  const isDetail = isDetailRoute(location.pathname);
  const isWatch = location.pathname.startsWith(`/${MAIN_PATH.watch}`) || location.pathname.startsWith("/watch");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        document.documentElement.style.setProperty("--page-w", `${document.documentElement.clientWidth}px`);
      });
    };
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <Box sx={{ width: "100%", minHeight: "100vh", bgcolor: "background.default", margin: 0, padding: 0, overflowX: "hidden" }}>
      <ScCdnRecovery />
      <GlobalPlayGlyphNormalizer />
      {!isWatch ? <MainHeader /> : null}
      {isHome ? <HomeHeroRuntimeFixes /> : null}
      {isHome ? <NetflixHomeAmbientExact /> : null}
      {!isWatch ? <MobileGlobalBottomNav /> : null}

      <Suspense fallback={null}>
        {isMobile && !isWatch && !isDetail ? <MobileSCExperience /> : null}
        {isMobile && !isWatch && !isDetail ? <MobileSCExactAssets /> : null}
        {isMobile && isHome ? <MobileHomeReferenceRuntime /> : null}
        {isMobile && isHome ? <MobileHomeSectionRecovery /> : null}
        {isWatch ? <WatchEpisodeAdvanceTracker /> : null}
      </Suspense>

      <LazyAuthModalMount />
      <SessionGuards />
      <DetailModalProvider>
        <PortalProvider>
          <Box className="flixit-route-stage">
            <Outlet />
          </Box>
          <LazyVideoPortalContainer />
        </PortalProvider>
      </DetailModalProvider>
      {!isWatch ? <Footer /> : null}
    </Box>
  );
}
