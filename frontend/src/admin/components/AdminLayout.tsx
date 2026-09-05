// @ts-nocheck
import React, { useState } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

import DashboardIcon from '@mui/icons-material/Dashboard';
import MovieIcon from '@mui/icons-material/Movie';
import FeaturedPlayListIcon from '@mui/icons-material/FeaturedPlayList';
import ViewCarouselIcon from '@mui/icons-material/ViewCarousel';
import HistoryIcon from '@mui/icons-material/History';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import HomeIcon from '@mui/icons-material/Home';
import SettingsIcon from '@mui/icons-material/Settings';

const DRAWER_WIDTH = 280;

interface NavItem {
  text: string;
  icon: React.ReactNode;
  path: string;
}

const menuItems: NavItem[] = [
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/admin/dashboard' },
  { text: 'Contenuti', icon: <MovieIcon />, path: '/admin/contents' },
  { text: 'Hero Section', icon: <ViewCarouselIcon />, path: '/admin/hero' },
  { text: 'Sezioni', icon: <FeaturedPlayListIcon />, path: '/admin/sections' },
  { text: 'Menu Header', icon: <MenuOpenIcon />, path: '/admin/menu' },
  { text: 'Impostazioni', icon: <SettingsIcon />, path: '/admin/settings' },
  { text: 'Log Attività', icon: <HistoryIcon />, path: '/admin/logs' },
];

const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { email, logout } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleDrawerToggle = (): void => {
    setMobileOpen(!mobileOpen);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>): void => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = (): void => {
    setAnchorEl(null);
  };

  const handleLogout = (): void => {
    handleMenuClose();
    logout();
    navigate('/admin/login');
  };

  const handleNavigate = (path: string): void => {
    navigate(path);
    if (isMobile) setMobileOpen(false);
  };

  const currentPage = menuItems.find((item) => item.path === location.pathname)?.text || 'Admin';

  const drawerContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#0d0d0d' }}>
      {/* Logo */}
      <Box sx={{ p: 3 }}>
        <Typography
          variant="h5"
          sx={{
            fontWeight: 800,
            color: '#e50914',
            letterSpacing: '2px',
            textAlign: 'center',
          }}
        >
          ADMIN
        </Typography>
        <Typography variant="caption" sx={{ color: 'grey.600', display: 'block', textAlign: 'center' }}>
          Pannello di controllo
        </Typography>
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

      {/* Navigation */}
      <List sx={{ flex: 1, px: 2, py: 3 }}>
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <ListItem key={item.path} disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                onClick={() => handleNavigate(item.path)}
                data-testid={`nav-${item.text.toLowerCase().replace(/\s/g, '-')}`}
                sx={{
                  borderRadius: 2,
                  py: 1.5,
                  bgcolor: isActive ? 'rgba(229, 9, 20, 0.12)' : 'transparent',
                  borderLeft: isActive ? '3px solid #e50914' : '3px solid transparent',
                  '&:hover': {
                    bgcolor: isActive ? 'rgba(229, 9, 20, 0.18)' : 'rgba(255,255,255,0.04)',
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    color: isActive ? '#e50914' : 'grey.500',
                    minWidth: 44,
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{
                    fontSize: 14,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? '#fff' : 'grey.400',
                  }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

      {/* Back to Site */}
      <List sx={{ px: 2, py: 2 }}>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => navigate('/browse')}
            data-testid="nav-back-to-site"
            sx={{
              borderRadius: 2,
              py: 1.5,
              '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
            }}
          >
            <ListItemIcon sx={{ color: 'grey.500', minWidth: 44 }}>
              <HomeIcon />
            </ListItemIcon>
            <ListItemText
              primary="Torna al Sito"
              primaryTypographyProps={{ fontSize: 14, color: 'grey.400' }}
            />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#0a0a0a' }}>
      {/* AppBar */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { lg: `${DRAWER_WIDTH}px` },
          bgcolor: 'rgba(10, 10, 10, 0.95)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <IconButton
              color="inherit"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 2, display: { lg: 'none' } }}
              data-testid="mobile-menu-btn"
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#fff' }}>
              {currentPage}
            </Typography>
          </Box>

          <IconButton onClick={handleMenuOpen} data-testid="user-menu-btn">
            <Avatar sx={{ width: 38, height: 38, bgcolor: '#e50914' }}>
              <PersonIcon fontSize="small" />
            </Avatar>
          </IconButton>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
            PaperProps={{
              sx: {
                bgcolor: '#1a1a1a',
                border: '1px solid rgba(255,255,255,0.1)',
                minWidth: 200,
                mt: 1,
              },
            }}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          >
            <MenuItem disabled>
              <Typography variant="body2" color="grey.500">
                {email}
              </Typography>
            </MenuItem>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />
            <MenuItem onClick={handleLogout} data-testid="logout-btn">
              <ListItemIcon>
                <LogoutIcon fontSize="small" sx={{ color: '#e50914' }} />
              </ListItemIcon>
              <ListItemText primary="Logout" />
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      <Box component="nav" sx={{ width: { lg: DRAWER_WIDTH }, flexShrink: { lg: 0 } }}>
        {/* Mobile Drawer */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', lg: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: DRAWER_WIDTH,
              bgcolor: '#0d0d0d',
              borderRight: '1px solid rgba(255,255,255,0.06)',
            },
          }}
        >
          {drawerContent}
        </Drawer>

        {/* Desktop Drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', lg: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: DRAWER_WIDTH,
              bgcolor: '#0d0d0d',
              borderRight: '1px solid rgba(255,255,255,0.06)',
            },
          }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, md: 4 },
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: '64px',
          minHeight: 'calc(100vh - 64px)',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
};

export default AdminLayout;
