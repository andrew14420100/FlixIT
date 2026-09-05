// @ts-nocheck
import { Navigate, createBrowserRouter } from "react-router-dom";
import { MAIN_PATH } from "src/constant";
import MainLayout from "src/layouts/MainLayout";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ComingSoonPage, { PLACEHOLDER_SECTIONS } from "src/pages/ComingSoonPage";
import {
  AuthProvider,
  ProtectedRoute,
  AdminLayout,
  LoginPage,
  DashboardPage,
  ContentsPage,
  HeroPage,
  SectionsPage,
  MenuPage,
  LogsPage,
  SettingsPage,
} from "src/admin";

function ErrorPage() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "#050505",
        color: "#fff",
        textAlign: "center",
        p: 4,
      }}
    >
      <Typography variant="h2" sx={{ fontWeight: 700, mb: 2, color: "#E50914" }}>
        404
      </Typography>
      <Typography variant="h5" sx={{ mb: 3, color: "rgba(255,255,255,0.7)" }}>
        Pagina non trovata
      </Typography>
      <Typography
        component="a"
        href="/"
        sx={{
          color: "#fff",
          bgcolor: "#E50914",
          px: 4,
          py: 1.5,
          borderRadius: "6px",
          textDecoration: "none",
          fontWeight: 600,
          "&:hover": { bgcolor: "#B20710" },
        }}
      >
        Torna alla Home
      </Typography>
    </Box>
  );
}

const router = createBrowserRouter([
  // Main Public Routes
  {
    path: "/",
    element: <MainLayout />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: MAIN_PATH.root,
        element: <Navigate to={`/${MAIN_PATH.browse}`} />,
      },
      {
        path: MAIN_PATH.browse,
        lazy: () => import("src/pages/HomePage"),
      },
      {
        path: `${MAIN_PATH.browse}/genre/movie`,
        lazy: () => import("src/pages/HomePage"),
      },
      {
        path: `${MAIN_PATH.browse}/genre/tv`,
        lazy: () => import("src/pages/HomePage"),
      },
      {
        path: `${MAIN_PATH.browse}/latest`,
        lazy: () => import("src/pages/HomePage"),
      },
      {
        path: `${MAIN_PATH.browse}/trending`,
        lazy: () => import("src/pages/HomePage"),
      },
      {
        path: "my-list",
        lazy: () => import("src/pages/MyListPage"),
      },
      {
        path: "archivio",
        lazy: () => import("src/pages/ArchivePage"),
      },
      ...Object.keys(PLACEHOLDER_SECTIONS).map((p) => ({
        path: p.slice(1),
        element: <ComingSoonPage />,
      })),
      {
        path: `${MAIN_PATH.browse}/:mediaType/:id`,
        lazy: () => import("src/pages/DetailPage"),
      },
      {
        path: MAIN_PATH.genreExplore,
        children: [
          {
            path: ":genreId",
            lazy: () => import("src/pages/GenreExplore"),
          },
        ],
      },
      {
        path: `${MAIN_PATH.watch}/:mediaType/:id`,
        lazy: () => import("src/pages/WatchPage"),
      },
      {
        path: MAIN_PATH.watch,
        lazy: () => import("src/pages/WatchPage"),
      },
      {
        path: "account",
        lazy: () => import("src/pages/AccountPage"),
      },
    ],
  },

  // Admin Login (standalone, no layout)
  {
    path: "/admin/login",
    element: (
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    ),
    errorElement: <ErrorPage />,
  },

  // Admin Protected Routes
  {
    path: "/admin",
    element: (
      <AuthProvider>
        <ProtectedRoute>
          <AdminLayout />
        </ProtectedRoute>
      </AuthProvider>
    ),
    errorElement: <ErrorPage />,
    children: [
      {
        index: true,
        element: <Navigate to="/admin/dashboard" replace />,
      },
      {
        path: "dashboard",
        element: <DashboardPage />,
      },
      {
        path: "contents",
        element: <ContentsPage />,
      },
      {
        path: "hero",
        element: <HeroPage />,
      },
      {
        path: "sections",
        element: <SectionsPage />,
      },
      {
        path: "menu",
        element: <MenuPage />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
      {
        path: "logs",
        element: <LogsPage />,
      },
    ],
  },

  // Catch-all 404
  {
    path: "*",
    element: <ErrorPage />,
  },
]);

export default router;
