// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { useNavigate, useLocation, useParams, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { adminSessionBase, clearAdminSession } from 'src/utils/adminSession';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Avatar from '@mui/material/Avatar';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import MovieCreationOutlinedIcon from '@mui/icons-material/MovieCreationOutlined';
import ViewAgendaOutlinedIcon from '@mui/icons-material/ViewAgendaOutlined';
import ViewCarouselOutlinedIcon from '@mui/icons-material/ViewCarouselOutlined';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MenuOpenRoundedIcon from '@mui/icons-material/MenuOpenRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import WorkspacePremiumOutlinedIcon from '@mui/icons-material/WorkspacePremiumOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import UpcomingOutlinedIcon from '@mui/icons-material/UpcomingOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import ImageSearchOutlinedIcon from '@mui/icons-material/ImageSearchOutlined';
import OndemandVideoOutlinedIcon from '@mui/icons-material/OndemandVideoOutlined';
import ArrowOutwardRoundedIcon from '@mui/icons-material/ArrowOutwardRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import './admin-shell.css';

const DRAWER_WIDTH = 286;

interface NavItem {
  text: string;
  icon: React.ReactNode;
  path: string;
}

const menuGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Panoramica',
    items: [
      { text: 'Dashboard', icon: <DashboardRoundedIcon />, path: '' },
    ],
  },
  {
    label: 'Catalogo',
    items: [
      { text: 'Contenuti', icon: <MovieCreationOutlinedIcon />, path: 'contents' },
      { text: 'Hero', icon: <ViewCarouselOutlinedIcon />, path: 'hero' },
      { text: 'Sezioni', icon: <ViewAgendaOutlinedIcon />, path: 'sections' },
      { text: 'In arrivo', icon: <UpcomingOutlinedIcon />, path: 'coming-soon' },
      { text: 'Artwork', icon: <ImageSearchOutlinedIcon />, path: 'artwork' },
      { text: 'Trailer', icon: <OndemandVideoOutlinedIcon />, path: 'trailers' },
    ],
  },
  {
    label: 'Premium',
    items: [
      { text: 'Piani Premium', icon: <WorkspacePremiumOutlinedIcon />, path: 'plans' },
      { text: 'Pagine Premium', icon: <AutoAwesomeOutlinedIcon />, path: 'premium-pages' },
      { text: 'Pagamenti', icon: <PaymentsOutlinedIcon />, path: 'payments' },
    ],
  },
  {
    label: 'Gestione',
    items: [
      { text: 'Utenti', icon: <PersonOutlineRoundedIcon />, path: 'users' },
      { text: 'Ticket', icon: <SupportAgentOutlinedIcon />, path: 'tickets' },
      { text: 'Menu Header', icon: <MenuOpenRoundedIcon />, path: 'menu' },
      { text: 'Impostazioni', icon: <SettingsOutlinedIcon />, path: 'settings' },
      { text: 'Log attività', icon: <HistoryRoundedIcon />, path: 'logs' },
    ],
  },
];

const allItems = menuGroups.flatMap((group) => group.items);

const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { adminSession } = useParams();
  const { email, logout } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const basePath = adminSessionBase(adminSession);

  const routeFor = (path: string) => (path ? `${basePath}/${path}` : basePath);
  const handleDrawerToggle = () => setMobileOpen((value) => !value);
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleMenuClose = () => setAnchorEl(null);
  const handleLogout = () => {
    handleMenuClose();
    logout();
    clearAdminSession();
    navigate('/browse', { replace: true });
  };
  const handleNavigate = (path: string) => {
    navigate(routeFor(path));
    if (isMobile) setMobileOpen(false);
  };

  const currentItem = useMemo(() => {
    const exact = allItems.find((item) => routeFor(item.path) === location.pathname);
    if (exact) return exact;
    return allItems.find((item) => item.path && location.pathname.startsWith(`${routeFor(item.path)}/`));
  }, [location.pathname, basePath]);
  const currentPage = currentItem?.text || 'Dashboard';

  const drawerContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'transparent' }}>
      <Box sx={{ px: 2.3, pt: 2.5, pb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.3, px: 1 }}>
          <Box
            sx={{
              width: 38,
              height: 38,
              display: 'grid',
              placeItems: 'center',
              borderRadius: '11px',
              bgcolor: 'rgba(229,9,20,.13)',
              border: '1px solid rgba(229,9,20,.28)',
              boxShadow: '0 8px 24px rgba(229,9,20,.10)',
            }}
          >
            <Typography sx={{ color: '#e50914', fontWeight: 900, fontSize: 26, lineHeight: 1, letterSpacing: '-.12em', transform: 'scaleX(.82)', transformOrigin: 'center' }}>
              F
            </Typography>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: '#fff', fontSize: 15.5, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-.015em' }}>
              FlixIT Control
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,.40)', fontSize: 11.5, mt: .45 }}>
              Centro amministrazione
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ px: 2.2, pb: 1.8 }}>
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            px: 1.4, py: 1,
            borderRadius: '11px',
            bgcolor: 'rgba(255,255,255,.028)',
            border: '1px solid rgba(140,170,196,.14)',
          }}
        >
          <SecurityRoundedIcon sx={{ fontSize: 17, color: '#8ee6a9' }} />
          <Typography sx={{ flex: 1, color: 'rgba(255,255,255,.64)', fontSize: 11.5 }}>Sessione protetta</Typography>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#63d487', boxShadow: '0 0 10px rgba(99,212,135,.6)' }} />
        </Box>
      </Box>

      <Box sx={{ height: '1px', bgcolor: 'rgba(153,181,205,.10)', mx: 2.4 }} />

      <List sx={{ flex: 1, px: 1.6, py: 1.6, overflowY: 'auto' }}>
        {menuGroups.map((group, groupIndex) => (
          <Box key={group.label} sx={{ mb: groupIndex === menuGroups.length - 1 ? 0 : 1.6 }}>
            <Typography
              sx={{
                px: 1.6,
                mb: .65,
                color: 'rgba(255,255,255,.30)',
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: '.09em',
                textTransform: 'uppercase',
              }}
            >
              {group.label}
            </Typography>

            {group.items.map((item) => {
              const target = routeFor(item.path);
              const isActive = location.pathname === target || (item.path && location.pathname.startsWith(`${target}/`));
              return (
                <ListItem key={item.text} disablePadding sx={{ mb: .35 }}>
                  <ListItemButton
                    onClick={() => handleNavigate(item.path)}
                    data-testid={`nav-${item.text.toLowerCase().replace(/\s/g, '-')}`}
                    sx={{
                      minHeight: 43,
                      px: 1.2,
                      py: .65,
                      borderRadius: '10px',
                      border: isActive ? '1px solid rgba(229,9,20,.22)' : '1px solid transparent',
                      bgcolor: isActive ? 'rgba(229,9,20,.105)' : 'transparent',
                      transition: 'background-color 150ms ease, border-color 150ms ease, transform 150ms ease',
                      '&:hover': {
                        bgcolor: isActive ? 'rgba(229,9,20,.14)' : 'rgba(255,255,255,.045)',
                        transform: 'translateX(2px)',
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 36,
                        color: isActive ? '#ff5962' : 'rgba(255,255,255,.48)',
                        '& svg': { fontSize: 20 },
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.text}
                      primaryTypographyProps={{
                        fontSize: 13.5,
                        lineHeight: 1.2,
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? '#fff' : 'rgba(255,255,255,.67)',
                      }}
                    />
                    {isActive ? <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#e50914', boxShadow: '0 0 10px rgba(229,9,20,.75)' }} /> : null}
                  </ListItemButton>
                </ListItem>
              );
            })}
          </Box>
        ))}
      </List>

      <Box sx={{ px: 1.6, pb: 1.6 }}>
        <Box sx={{ height: '1px', bgcolor: 'rgba(153,181,205,.10)', mb: 1.2, mx: .8 }} />
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => navigate('/browse')}
            data-testid="nav-back-to-site"
            sx={{ minHeight: 44, px: 1.2, borderRadius: '10px', '&:hover': { bgcolor: 'rgba(255,255,255,.045)' } }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: 'rgba(255,255,255,.48)' }}><HomeRoundedIcon sx={{ fontSize: 20 }} /></ListItemIcon>
            <ListItemText primary="Torna a FlixIT" primaryTypographyProps={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,.67)' }} />
            <ArrowOutwardRoundedIcon sx={{ fontSize: 16, color: 'rgba(255,255,255,.28)' }} />
          </ListItemButton>
        </ListItem>
      </Box>
    </Box>
  );

  return (
    <Box className="flixit-admin" sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { lg: `${DRAWER_WIDTH}px` },
          height: 76,
          justifyContent: 'center',
          bgcolor: 'rgba(3,12,22,.72)',
          backgroundImage: 'linear-gradient(180deg, rgba(8,24,40,.32), rgba(3,12,22,.10))',
          backdropFilter: 'blur(22px) saturate(140%)',
          borderBottom: '1px solid rgba(135,164,189,.14)',
          boxShadow: 'none',
        }}
      >
        <Toolbar sx={{ minHeight: '76px !important', px: { xs: 2, md: 3.2 }, justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <IconButton
              color="inherit"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 1.3, display: { lg: 'none' }, border: '1px solid rgba(255,255,255,.10)', borderRadius: '10px' }}
              data-testid="mobile-menu-btn"
            >
              <MenuRoundedIcon />
            </IconButton>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ color: 'rgba(255,255,255,.38)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.085em', textTransform: 'uppercase' }}>
                FlixIT Control
              </Typography>
              <Typography noWrap sx={{ color: '#fff', fontSize: { xs: 18, md: 21 }, fontWeight: 750, letterSpacing: '-.025em', mt: .2 }}>
                {currentPage}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Chip
              label="LIVE"
              size="small"
              sx={{
                display: { xs: 'none', sm: 'inline-flex' },
                height: 27,
                color: '#9be8b4 !important',
                bgcolor: 'rgba(76,187,113,.08) !important',
                border: '1px solid rgba(88,201,126,.18) !important',
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: '.08em',
              }}
            />
            <IconButton
              onClick={handleMenuOpen}
              data-testid="user-menu-btn"
              sx={{
                p: .45,
                border: '1px solid rgba(154,182,205,.20)',
                bgcolor: 'rgba(255,255,255,.035)',
                borderRadius: '12px',
              }}
            >
              <Avatar sx={{ width: 38, height: 38, bgcolor: '#e50914', color: '#fff', fontSize: 14, fontWeight: 800 }}>
                {String(email || 'A').trim().charAt(0).toUpperCase()}
              </Avatar>
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              PaperProps={{ className: 'flixit-admin-menu', sx: { minWidth: 245, mt: 1.2, p: .6 } }}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              <Box sx={{ px: 1.4, py: 1.2 }}>
                <Typography sx={{ color: 'rgba(255,255,255,.38)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>Amministratore</Typography>
                <Typography noWrap sx={{ color: '#fff', fontSize: 13.5, fontWeight: 650, mt: .35 }}>{email || 'Admin'}</Typography>
              </Box>
              <Divider sx={{ my: .5 }} />
              <MenuItem onClick={handleLogout} data-testid="logout-btn" sx={{ borderRadius: '9px', py: 1.1 }}>
                <ListItemIcon><LogoutRoundedIcon fontSize="small" sx={{ color: '#ff6971' }} /></ListItemIcon>
                <ListItemText primary="Esci dal pannello" primaryTypographyProps={{ fontSize: 13.5, fontWeight: 600, color: '#ff8c92' }} />
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { lg: DRAWER_WIDTH }, flexShrink: { lg: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', lg: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box', width: DRAWER_WIDTH,
              bgcolor: 'rgba(3,12,22,.97)',
              backgroundImage: 'linear-gradient(180deg, rgba(12,35,57,.34), rgba(3,12,22,.12))',
              borderRight: '1px solid rgba(135,164,189,.17)',
              backdropFilter: 'blur(24px)',
            },
          }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', lg: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box', width: DRAWER_WIDTH,
              bgcolor: 'rgba(3,12,22,.94)',
              backgroundImage: 'linear-gradient(180deg, rgba(12,35,57,.30), rgba(3,12,22,.08) 42%, rgba(1,9,18,.55))',
              borderRight: '1px solid rgba(135,164,189,.15)',
              boxShadow: '18px 0 46px rgba(0,0,0,.12)',
            },
          }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box
        component="main"
        className="flixit-admin-main"
        sx={{
          flexGrow: 1,
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          minWidth: 0,
          minHeight: '100vh',
          pt: '76px',
          px: { xs: 1.6, sm: 2.2, md: 3.4 },
          pb: { xs: 3, md: 5 },
        }}
      >
        <Box className="flixit-admin-content" sx={{ pt: { xs: 2, md: 3.2 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};

export default AdminLayout;
