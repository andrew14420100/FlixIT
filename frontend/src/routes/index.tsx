// @ts-nocheck
import { Navigate, createBrowserRouter } from "react-router-dom";
import { MAIN_PATH } from "src/constant";
import MainLayout from "src/layouts/MainLayout";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ComingSoonPage, { PLACEHOLDER_SECTIONS } from "src/pages/ComingSoonPage";

const adminChunk = () => import("src/admin/lazyRoutes");
const adminPage = (name) => () => adminChunk().then((m) => ({ Component: m[name] }));
const homePage = () => import("src/pages/HomePage");

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
      // Avoid a client-side / -> /browse redirect on hard refresh. Both URLs
      // render the same lazy Home chunk and share the same bootstrap/cache.
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

export default router;
