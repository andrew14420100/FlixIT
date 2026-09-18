// @ts-nocheck
// Entry point of the admin bundle: loaded on demand so the public app never ships admin code.
import { AuthProvider, ProtectedRoute, AdminLayout, LoginPage } from "src/admin";

export function AdminShell() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <AdminLayout />
      </ProtectedRoute>
    </AuthProvider>
  );
}

export function AdminLoginShell() {
  return (
    <AuthProvider>
      <LoginPage />
    </AuthProvider>
  );
}

export {
  DashboardPage, ContentsPage, HeroPage, SectionsPage, MenuPage, LogsPage, SettingsPage, ArtworkPage, TrailersPage,
  UsersPage, TicketsPage, PlansPage, PremiumPagesPage, ComingSoonAdminPage, PaymentsPage,
} from "src/admin";
