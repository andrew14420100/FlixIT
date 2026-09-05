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

export default function MainLayout() {
  const location = useLocation();
  const navigation = useNavigation();

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Real layout width (excludes the scrollbar) shared with CSS (--card-h for the Top 10 row)
  useEffect(() => {
    const update = () => document.documentElement.style.setProperty("--page-w", `${document.documentElement.clientWidth}px`);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: "100vh",
        bgcolor: "background.default",
        margin: 0,
        padding: 0,
        overflowX: "hidden",
      }}
    >
      <MainHeader />
      <AuthModal />
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
