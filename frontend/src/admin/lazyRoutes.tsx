// @ts-nocheck
// Entry point of the admin bundle: loaded on demand so the public app never ships admin code.
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { AuthProvider, ProtectedRoute, AdminLayout, LoginPage } from "src/admin";
import adminTheme from "src/admin/adminTheme";

function AdminTheme({ children }) {
  return (
    <ThemeProvider theme={adminTheme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export function AdminShell() {
  return (
    <AdminTheme>
      <AuthProvider>
        <ProtectedRoute>
          <AdminLayout />
        </ProtectedRoute>
      </AuthProvider>
    </AdminTheme>
  );
}

export function AdminLoginShell() {
  return (
    <AdminTheme>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </AdminTheme>
  );
}

export {
  DashboardPage, ContentsPage, HeroPage, SectionsPage, MenuPage, LogsPage, SettingsPage, ArtworkPage, TrailersPage,
  UsersPage, TicketsPage, PlansPage, PremiumPagesPage, ComingSoonAdminPage, PaymentsPage,
} from "src/admin";
