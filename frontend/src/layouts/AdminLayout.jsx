import React, { useEffect } from 'react';
import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useAdminStore } from '../store/adminStore';
import { 
  LayoutDashboard, 
  Film, 
  ImageIcon, 
  Layers, 
  FileText, 
  LogOut,
  Menu,
  X
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Toaster } from '../components/ui/sonner';

const navItems = [
  { path: '/admin', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { path: '/admin/contents', icon: Film, label: 'Contenuti' },
  { path: '/admin/hero', icon: ImageIcon, label: 'Hero Section' },
  { path: '/admin/sections', icon: Layers, label: 'Sezioni Homepage' },
  { path: '/admin/logs', icon: FileText, label: 'Activity Logs' },
];

export default function AdminLayout() {
  const { isAuthenticated, admin, logout } = useAdminStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/admin/login');
    }
  }, [isAuthenticated, navigate]);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  const isActive = (path, exact = false) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-[#0F0F0F] border-b border-white/10 z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="font-bold text-lg tracking-tight" style={{ fontFamily: 'Unbounded, sans-serif' }}>
            <span className="text-[#E50914]">FLIX</span>ADMIN
          </span>
        </div>
      </div>

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 h-full w-64 bg-[#0A0A0A] border-r border-white/5 z-40 transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="h-16 flex items-center px-6 border-b border-white/5">
            <Link to="/admin" className="flex items-center gap-2">
              <span className="font-bold text-xl tracking-tight" style={{ fontFamily: 'Unbounded, sans-serif' }}>
                <span className="text-[#E50914]">FLIX</span>ADMIN
              </span>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-6 px-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path, item.exact);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group ${
                    active 
                      ? 'bg-[#E50914] text-white shadow-lg shadow-red-900/30' 
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon size={20} className={active ? '' : 'group-hover:text-[#E50914] transition-colors'} />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* User Section */}
          <div className="p-4 border-t border-white/5">
            <div className="bg-zinc-900/50 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#E50914] to-red-700 flex items-center justify-center font-bold">
                  {admin?.email?.charAt(0).toUpperCase() || 'A'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{admin?.name || 'Admin'}</p>
                  <p className="text-xs text-zinc-500 truncate">{admin?.email}</p>
                </div>
              </div>
              <Button 
                variant="ghost" 
                className="w-full justify-start text-zinc-400 hover:text-white hover:bg-white/5"
                onClick={handleLogout}
                data-testid="logout-btn"
              >
                <LogOut size={18} className="mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="lg:pl-64 pt-16 lg:pt-0 min-h-screen">
        <div className="p-6 lg:p-10">
          <Outlet />
        </div>
      </main>

      <Toaster position="top-right" theme="dark" />
    </div>
  );
}
