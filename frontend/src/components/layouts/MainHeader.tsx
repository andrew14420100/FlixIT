// @ts-nocheck
import * as React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuIcon from "@mui/icons-material/Menu";
import Avatar from "@mui/material/Avatar";
import MenuItem from "@mui/material/MenuItem";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import useOffSetTop from "src/hooks/useOffSetTop";
import { APP_BAR_HEIGHT } from "src/constant";
import Logo from "../Logo";
import SearchBox from "../SearchBox";
import { useAuthModal } from "src/store/authModal";
import ProfileMenu from "./ProfileMenu";
import NotificationsBell from "./NotificationsBell";
import { useNotifications } from "src/hooks/useNotifications";
import { avatarSrc } from "src/config/avatars";

const API_URL = "";
const MENU_CACHE_KEY = "flixit_public_menu_v1";
const MENU_CACHE_MS = 30 * 60 * 1000;
const ME_MEMO_MS = 60 * 1000;

const NAV_ITEMS = [
  { id: "home", name: "Home", path: "/browse" },
  { id: "cinema", name: "Cinema", path: "/cinema" },
  { id: "serie", name: "Serie TV", path: "/serie" },
  { id: "prime-visioni", name: "Prime Visioni", path: "/p/prime-visioni" },
  { id: "cinema-d-autore", name: "Cinema d'Autore", path: "/p/cinema-d-autore" },
  { id: "catalogo", name: "Catalogo", path: "/archivio" },
];
const isPremiumPath = (p) => (p || "").startsWith("/p/");

let menuMemo: { at: number; promise: Promise<any> } | null = null;
let meMemo: { token: string; at: number; promise: Promise<any> } | null = null;

function readMenuCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || "null");
    if (!cached?.savedAt || !Array.isArray(cached?.items) || !cached.items.length) return null;
    return cached;
  } catch {
    return null;
  }
}

function persistMenu(items) {
  try {
    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
  } catch {}
}

function fetchMenuShared() {
  const now = Date.now();
  if (menuMemo && now - menuMemo.at < MENU_CACHE_MS) return menuMemo.promise;
  const promise = fetch(`${API_URL}/api/public/menu`, { headers: { Accept: "application/json" } })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      if (data?.items?.length) persistMenu(data.items);
      return data;
    })
    .catch(() => null);
  menuMemo = { at: now, promise };
  return promise;
}

function fetchMeShared(token: string) {
  const now = Date.now();
  if (meMemo?.token === token && now - meMemo.at < ME_MEMO_MS) return meMemo.promise;
  const promise = fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  })
    .then((response) => response.ok ? response.json() : null)
    .catch(() => null);
  meMemo = { token, at: now, promise };
  return promise;
}

const MainHeader = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isOffset = useOffSetTop(APP_BAR_HEIGHT);
  const [menuItems, setMenuItems] = React.useState(() => readMenuCache()?.items || NAV_ITEMS);
  const [anchorElNav, setAnchorElNav] = React.useState(null);
  const [anchorElUser, setAnchorElUser] = React.useState(null);
  const [userInfo, setUserInfo] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    let idleId: any = null;
    let timer = 0;
    const cached = readMenuCache();
    if (cached?.items?.length) setMenuItems(cached.items);

    const refreshMenu = () => {
      fetchMenuShared().then((data) => {
        if (!cancelled && data?.items?.length) setMenuItems(data.items);
      });
    };

    // NAV_ITEMS / local cache are sufficient for the initial header frame. Menu
    // revalidation is low priority and should not compete with Home bootstrap,
    // Hero imagery and the first visible cards on a hard refresh.
    const cacheIsFresh = cached?.savedAt && Date.now() - Number(cached.savedAt) < MENU_CACHE_MS;
    if (!cacheIsFresh) {
      if ("requestIdleCallback" in window) {
        idleId = (window as any).requestIdleCallback(refreshMenu, { timeout: 2200 });
      } else {
        timer = window.setTimeout(refreshMenu, 900);
      }
    }

    const token = localStorage.getItem("user_token");
    if (token) {
      fetchMeShared(token).then((data) => {
        if (!cancelled && data) setUserInfo(data);
      });
    }

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (idleId != null && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, []);

  const isLoggedIn = !!localStorage.getItem("user_token");
  const openAuthModal = useAuthModal((s) => s.openModal);
  const notifications = useNotifications();
  const visibleMenuItems = menuItems.filter(i => i.active !== false && i.visible !== false);
  const isActive = (path) => {
    if (path === "/browse") return location.pathname === "/browse" || location.pathname === "/";
    return location.pathname.startsWith(path);
  };
  const avatarImage = avatarSrc(isLoggedIn ? userInfo?.profileImage : null);
  const locked = (item) => isPremiumPath(item.path) && !(userInfo?.is_premium);

  return (
    <AppBar
      data-testid="main-header"
      sx={{
        px: { xs: '12px', sm: '24px', md: '40px' },
        height: APP_BAR_HEIGHT,
        backgroundImage: "none",
        transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)",
        borderBottom: isOffset ? '1px solid rgba(255,255,255,0.03)' : 'none',
        ...(isOffset
          ? { bgcolor: "rgba(5,5,5,0.88)", backdropFilter: "blur(24px) saturate(180%)" }
          : { boxShadow: 0, bgcolor: "transparent" }),
      }}
    >
      <Toolbar disableGutters sx={{ height: '100%', minHeight: 'unset !important' }}>
        <Logo sx={{ mr: { xs: 3, sm: 5 } }} variant="header" />

        <Box sx={{ flexGrow: 1, display: { xs: "flex", md: "none" } }}>
          <IconButton size="medium" onClick={(e) => setAnchorElNav(e.currentTarget)} sx={{ color: 'rgba(255,255,255,0.7)' }}>
            <MenuIcon sx={{ fontSize: 22 }} />
          </IconButton>
          <Menu
            anchorEl={anchorElNav}
            open={Boolean(anchorElNav)}
            onClose={() => setAnchorElNav(null)}
            sx={{
              "& .MuiPaper-root": {
                bgcolor: "rgba(12,12,12,0.97)", backdropFilter: "blur(24px)",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: '12px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              },
            }}
          >
            {visibleMenuItems.map((item) => (
              <MenuItem key={item.id} onClick={() => { setAnchorElNav(null); navigate(item.path || "/browse"); }}
                sx={{ color: isActive(item.path) ? '#fff' : '#888', fontWeight: isActive(item.path) ? 600 : 400, fontSize: 14, py: 1.2 }}>
                {item.name || item.label}
              </MenuItem>
            ))}
          </Menu>
        </Box>

        <Stack direction="row" spacing={0.3} sx={{ flexGrow: 1, display: { xs: "none", md: "flex" } }}>
          {visibleMenuItems.map((item) => {
            const active = isActive(item.path || "/browse");
            return (
              <Box key={item.id} component="button"
                data-testid={`nav-${(item.name || '').toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => { const p = item.path || item.link || "/browse"; p.startsWith("http") ? window.open(p, "_blank") : navigate(p); }}
                sx={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  px: 1.8, py: 0.8, borderRadius: '8px',
                  fontFamily: "'Inter', sans-serif", fontSize: '15.5px',
                  fontWeight: active ? 600 : 400,
                  color: active ? '#fff' : 'rgba(255,255,255,0.72)',
                  transition: 'color 0.2s ease', position: 'relative', whiteSpace: 'nowrap',
                  '&:hover': { color: '#fff' },
                  '&::after': active ? {
                    content: '""', position: 'absolute', bottom: '0px',
                    left: '50%', transform: 'translateX(-50%)',
                    width: '16px', height: '2.5px', borderRadius: '2px', bgcolor: '#E50914',
                  } : {},
                }}
              >
                {item.name || item.label}
                {locked(item) && <LockOutlinedIcon data-testid={`nav-lock-${item.id}`} sx={{ fontSize: 13, ml: 0.6, mb: '2px', verticalAlign: 'middle', color: '#ff5a63' }} />}
              </Box>
            );
          })}
        </Stack>

        <Stack direction="row" spacing={1.5} alignItems="center">
          <SearchBox />

          {!isLoggedIn && (
            <Box
              component="button"
              onClick={() => openAuthModal("login")}
              data-testid="header-login-button"
              sx={{
                height: 40, px: 2.4, borderRadius: '9px', border: 'none', cursor: 'pointer', color: '#fff', bgcolor: '#E50914',
                fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 15, letterSpacing: '0.01em',
                transition: 'background-color 200ms ease, transform 150ms ease, box-shadow 200ms ease',
                '&:hover': { bgcolor: '#F6121D', boxShadow: '0 6px 18px rgba(229,9,20,0.35)' }, '&:active': { transform: 'scale(0.98)' },
              }}
            >
              Accedi
            </Box>
          )}

          {isLoggedIn && <NotificationsBell notifications={notifications} />}

          {isLoggedIn && (
          <Box
            onClick={(e) => setAnchorElUser(e.currentTarget)}
            data-testid="avatar-menu-button"
            sx={{
              display: 'flex', alignItems: 'center', gap: '5px',
              cursor: 'pointer', borderRadius: '10px',
              px: 0.5, py: 0.3,
              border: '1px solid transparent',
              transition: 'all 0.25s ease',
              '&:hover': {
                bgcolor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
              },
            }}
          >
            <Avatar
              variant="rounded"
              src={avatarImage}
              alt={isLoggedIn ? (userInfo?.name || 'Profilo') : 'Ospite'}
              data-testid="header-avatar"
              sx={{
                width: 38, height: 38, borderRadius: '8px', bgcolor: '#222',
                border: '2px solid rgba(255,255,255,0.12)',
                transition: 'border-color 0.25s ease, transform 0.25s ease',
                '&:hover': { borderColor: 'rgba(255,255,255,0.4)', transform: 'scale(1.05)' },
              }}
            />
            <KeyboardArrowDownIcon sx={{
              fontSize: 15, color: 'rgba(255,255,255,0.35)',
              transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1), color 0.2s',
              transform: anchorElUser ? 'rotate(180deg)' : 'rotate(0)',
              display: { xs: 'none', md: 'block' },
            }} />
          </Box>
          )}

          {isLoggedIn && (
            <ProfileMenu
              anchorEl={anchorElUser}
              onClose={() => setAnchorElUser(null)}
              user={userInfo}
              avatarImage={avatarImage}
              onNavigate={(to) => { setAnchorElUser(null); navigate(to); }}
              onLogout={() => { setAnchorElUser(null); localStorage.removeItem('user_token'); localStorage.removeItem('admin_token'); window.location.reload(); }}
            />
          )}
        </Stack>
      </Toolbar>
    </AppBar>
  );
};

export default MainHeader;
