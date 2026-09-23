// @ts-nocheck
import { Navigate, createBrowserRouter } from "react-router-dom";
import { MAIN_PATH } from "src/constant";
import MainLayout from "src/layouts/MainLayout";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ComingSoonPage, { PLACEHOLDER_SECTIONS } from "src/pages/ComingSoonPage";

const adminChunk = () => import("src/admin/lazyRoutes");
const adminPage = (name) => () => adminChunk().then((m) => ({ Component: m[name] }));

function isHomeRoute(pathname = "") {
  const raw = String(pathname || "/");
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  return (
    path === "/" ||
    path === `/${MAIN_PATH.browse}` ||
    path === `/${MAIN_PATH.browse}/genre/movie` ||
    path === `/${MAIN_PATH.browse}/genre/tv` ||
    path === `/${MAIN_PATH.browse}/latest` ||
    path === `/${MAIN_PATH.browse}/trending`
  );
}

// Start downloading the Home route chunk as soon as the router module executes
// instead of waiting for React Router's lazy match. It remains a separate chunk,
// so parsing the main shell does not get heavier.
const initialHomeChunk =
  typeof window !== "undefined" && isHomeRoute(window.location.pathname)
    ? import("src/pages/HomePage")
    : null;
const homePage = () => initialHomeChunk || import("src/pages/HomePage");

function ErrorPage() {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", bgcolor: "#050505", color: "#fff", textAlign: "center", p: 4 }}>
      <Typography variant="h2" sx={{ fontWeight: 700, mb: 2, color: "#E50914" }}>404</Typography>
      <Typography variant="h5" sx={{ mb: 3, color: "rgba(255,255,255,0.7)" }}>Pagina non trovata</Typography>
      <Typography component="a" href="/" sx={{ color: "#fff", bgcolor: "#E50914", px: 4, py: 1.5, borderRadius: "6px", textDecoration: "none", fontWeight: 600, "&:hover": { bgcolor: "#B20710" } }}>Torna alla Home</Typography>
    </Box>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <MainLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, lazy: homePage },
      { path: MAIN_PATH.browse, lazy: homePage },
      { path: `${MAIN_PATH.browse}/genre/movie`, lazy: homePage },
      { path: `${MAIN_PATH.browse}/genre/tv`, lazy: homePage },
      { path: `${MAIN_PATH.browse}/latest`, lazy: homePage },
      { path: `${MAIN_PATH.browse}/trending`, lazy: homePage },
      { path: "my-list", lazy: () => import("src/pages/MyListPage") },
      { path: "film", lazy: () => import("src/pages/FilmPage") },
      { path: "serie-tv", lazy: () => import("src/pages/SeriePage") },
      { path: "archivio", lazy: () => import("src/pages/ArchivePage") },
      { path: "cinema", lazy: () => import("src/pages/CinemaHubPage") },
      { path: "serie", lazy: () => import("src/pages/SerieHubPage") },
      { path: "p/:slug", lazy: () => import("src/pages/PremiumPage") },
      { path: "premium", lazy: () => import("src/pages/PricingPage") },
      { path: "premium/success", lazy: () => import("src/pages/PaymentResultPage") },
      { path: "premium/paypal-return", lazy: () => import("src/pages/PaymentResultPage") },
      { path: "premium/cancel", lazy: () => import("src/pages/PaymentResultPage") },
      ...Object.keys(PLACEHOLDER_SECTIONS).map((p) => ({ path: p.slice(1), element: <ComingSoonPage /> })),
      { path: `${MAIN_PATH.browse}/:mediaType/:id`, lazy: () => import("src/pages/DetailPage") },
      { path: MAIN_PATH.genreExplore, children: [{ path: ":genreId", lazy: () => import("src/pages/GenreExplore") }] },
      { path: `${MAIN_PATH.watch}/:mediaType/:id`, lazy: () => import("src/pages/WatchPage") },
      { path: MAIN_PATH.watch, lazy: () => import("src/pages/WatchPage") },
      { path: "account", lazy: () => import("src/pages/AccountPage") },
    ],
  },
  { path: "/admin/login", lazy: adminPage("AdminLoginShell"), errorElement: <ErrorPage /> },
  {
    path: "/admin",
    lazy: adminPage("AdminShell"),
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/admin/dashboard" replace /> },
      { path: "dashboard", lazy: adminPage("DashboardPage") },
      { path: "contents", lazy: adminPage("ContentsPage") },
      { path: "hero", lazy: adminPage("HeroPage") },
      { path: "sections", lazy: adminPage("SectionsPage") },
      { path: "menu", lazy: adminPage("MenuPage") },
      { path: "settings", lazy: adminPage("SettingsPage") },
      { path: "artwork", lazy: adminPage("ArtworkPage") },
      { path: "trailers", lazy: adminPage("TrailersPage") },
      { path: "logs", lazy: adminPage("LogsPage") },
      { path: "users", lazy: adminPage("UsersPage") },
      { path: "tickets", lazy: adminPage("TicketsPage") },
      { path: "plans", lazy: adminPage("PlansPage") },
      { path: "premium-pages", lazy: adminPage("PremiumPagesPage") },
      { path: "coming-soon", lazy: adminPage("ComingSoonAdminPage") },
      { path: "payments", lazy: adminPage("PaymentsPage") },
    ],
  },
  { path: "*", element: <ErrorPage /> },
]);

function canWarmLikelyNextRoutes() {
  if (typeof navigator === "undefined") return true;
  const connection =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection;
  if (!connection) return true;
  if (connection.saveData) return false;
  const effectiveType = String(connection.effectiveType || "").toLowerCase();
  return effectiveType !== "slow-2g" && effectiveType !== "2g";
}

// Warm Detail and Watch only after the initial document has fully loaded. On
// constrained or data-saver connections the browser should spend bandwidth on
// Hero/card images and API data instead of speculative JavaScript chunks.
if (typeof window !== "undefined" && isHomeRoute(window.location.pathname)) {
  const warmLikelyNextRoutes = () => {
    if (!canWarmLikelyNextRoutes() || document.visibilityState === "hidden") return;
    import("src/pages/DetailPage").catch(() => {});
    import("src/pages/WatchPage").catch(() => {});
  };

  const scheduleWarm = () => {
    if (!canWarmLikelyNextRoutes()) return;
    if ("requestIdleCallback" in window) {
      (window as any).requestIdleCallback(warmLikelyNextRoutes, { timeout: 6000 });
    } else {
      window.setTimeout(warmLikelyNextRoutes, 4000);
    }
  };

  if (document.readyState === "complete") {
    scheduleWarm();
  } else {
    window.addEventListener("load", scheduleWarm, { once: true });
  }
}

export default router;
