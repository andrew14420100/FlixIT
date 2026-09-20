// @ts-nocheck
import { useEffect } from "react";
import { Outlet, useLocation, useNavigation } from "react-router-dom";
import Box from "@mui/material/Box";

import VideoPortalContainer from "src/components/VideoPortalContainer";
import PortalProvider from "src/providers/PortalProvider";
import DetailModalProvider from "src/providers/DetailModalProvider";
import { MAIN_PATH } from "src/constant";
import { Footer, MainHeader } from "src/components/layouts";
import MainLoadingScreen from "src/components/MainLoadingScreen";
import AuthModal from "src/components/auth/AuthModal";
import SessionGuards from "src/components/auth/SessionGuards";
import MobileSCExperience from "src/components/mobile/MobileSCExperience";
import MobileSCExactAssets from "src/components/mobile/MobileSCExactAssets";
import MobileHomeReferenceRuntime from "src/components/mobile/MobileHomeReferenceRuntime";
import "src/components/mobile/mobile-sc-exact.css";
import "src/components/mobile/mobile-home-reference.css";

export default function MainLayout() {
  const location = useLocation();
  const navigation = useNavigation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const update = () => document.documentElement.style.setProperty("--page-w", `${document.documentElement.clientWidth}px`);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <Box sx={{ width: "100%", minHeight: "100vh", bgcolor: "background.default", margin: 0, padding: 0, overflowX: "hidden" }}>
      <MainHeader />
      <MobileSCExperience />
      <MobileSCExactAssets />
      <MobileHomeReferenceRuntime />
      <AuthModal />
      <SessionGuards />
      {navigation.state !== "idle" && <MainLoadingScreen />}
      <DetailModalProvider>
        <PortalProvider>
          <Outlet />
          <VideoPortalContainer />
        </PortalProvider>
      </DetailModalProvider>
      {location.pathname !== `/${MAIN_PATH.watch}` && <Footer />}
    </Box>
  );
}
