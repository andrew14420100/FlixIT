// @ts-nocheck
import * as React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Menu from "@mui/material/Menu";
import MenuIcon from "@mui/icons-material/Menu";
import Avatar from "@mui/material/Avatar";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import PersonIcon from "@mui/icons-material/Person";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import LogoutIcon from "@mui/icons-material/Logout";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import useOffSetTop from "src/hooks/useOffSetTop";
import { APP_BAR_HEIGHT } from "src/constant";
import Logo from "../Logo";
import SearchBox from "../SearchBox";
import { useAuthModal } from "src/store/authModal";

const API_URL = "";
import { avatarSrc } from "src/config/avatars";

const NAV_ITEMS = [
  { id: "home", name: "Home", path: "/browse" },
  { id: "serie-tv", name: "Serie TV", path: "/serie-tv" },
  { id: "film", name: "Film", path: "/film" },
  { id: "archivio", name: "Archivio", path: "/archivio" },
  { id: "premium", name: "Premium", path: "/premium" },
  { id: "richiedi-un-titolo", name: "Richiedi un titolo", path: "/richiedi-un-titolo" },
];

const MainHeader = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isOffset = useOffSetTop(APP_BAR_HEIGHT);
  const [menuItems, setMenuItems] = React.useState(NAV_ITEMS);
  const [anchorElNav, setAnchorElNav] = React.useState(null);
  const [anchorElUser, setAnchorElUser] = React.useState(null);
  const [userInfo, setUserInfo] = React.useState(null);

  React.useEffect(() => {
    fetch(`${API_URL}/api/public/menu`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.items?.length > 0) setMenuItems(data.items); })
      .catch(() => {});
    const token = localStorage.getItem("user_token");
    if (token) {
      fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setUserInfo(data); })
        .catch(() => {});
    }
  }, []);

  const isLoggedIn = !!localStorage.getItem("user_token");
  const openAuthModal = useAuthModal((s) => s.openModal);
  const visibleMenuItems = menuItems.filter(i => i.active !== false && i.visible !== false);
  const isActive = (path) => {
    if (path === "/browse") return location.pathname === "/browse" || location.pathname === "/";
    return location.pathname.startsWith(path);
  };
  const avatarImage = avatarSrc(isLoggedIn ? userInfo?.profileImage : null);

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

        {/* Mobile Menu */}
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

        {/* Desktop Nav */}
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
              </Box>
            );
          })}
        </Stack>

        {/* Right: Search + Avatar */}
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

          {/* Avatar Button - only for authenticated users */}
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

          {/* Dropdown - Premium glassmorphism */}
          {isLoggedIn && (
          <Menu
            sx={{
              mt: '50px',
              '& .MuiPaper-root': {
                bgcolor: 'rgba(10,10,10,0.92)',
                backdropFilter: 'blur(32px) saturate(200%)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '14px',
                minWidth: 220,
                boxShadow: '0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03) inset',
                overflow: 'hidden',
                py: 0.5,
              },
              '& .MuiMenuItem-root': {
                color: 'rgba(255,255,255,0.55)', py: 1.2, px: 2, fontSize: 13.5,
                fontFamily: "'Inter', sans-serif", borderRadius: '8px', mx: 0.5,
                transition: 'all 0.15s ease',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.06)', color: '#fff' },
              },
            }}
            anchorEl={anchorElUser}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            keepMounted
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            open={Boolean(anchorElUser)}
            onClose={() => setAnchorElUser(null)}
          >
            {isLoggedIn && userInfo && (
              <Box sx={{ px: 2, py: 1.5, mx: 0.5 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Avatar variant="rounded" src={avatarImage} sx={{ width: 36, height: 36, borderRadius: '6px', bgcolor: '#222' }} />
                  <Box>
                    <Typography sx={{ color: '#fff', fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>{userInfo.name}</Typography>
                    <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: 11.5 }}>{userInfo.email}</Typography>
                  </Box>
                </Stack>
              </Box>
            )}
            {isLoggedIn && <Divider sx={{ borderColor: 'rgba(255,255,255,0.05)', mx: 1 }} />}
            <MenuItem onClick={() => { setAnchorElUser(null); navigate('/account'); }} data-testid="menu-account">
              <ListItemIcon><PersonIcon sx={{ color: 'rgba(255,255,255,0.35)', fontSize: 18 }} /></ListItemIcon>
              Account
            </MenuItem>
            <MenuItem onClick={() => { setAnchorElUser(null); navigate('/my-list'); }} data-testid="menu-my-list">
              <ListItemIcon><PlayCircleOutlineIcon sx={{ color: 'rgba(255,255,255,0.35)', fontSize: 18 }} /></ListItemIcon>
              La mia lista
            </MenuItem>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.05)', mx: 1 }} />
            <MenuItem onClick={() => { setAnchorElUser(null); localStorage.removeItem('user_token'); window.location.reload(); }} data-testid="menu-logout">
              <ListItemIcon><LogoutIcon sx={{ color: '#E50914', fontSize: 18 }} /></ListItemIcon>
              <Typography sx={{ color: '#E50914', fontSize: 13.5, fontWeight: 500 }}>Esci</Typography>
            </MenuItem>
          </Menu>
          )}
        </Stack>
      </Toolbar>
    </AppBar>
  );
};

export default MainHeader;
