// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Skeleton from '@mui/material/Skeleton';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ViewCarouselIcon from '@mui/icons-material/ViewCarousel';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import LibraryAddIcon from '@mui/icons-material/LibraryAdd';
import { adminAPI } from '../services/api';
import { tmdbService } from '../services/tmdb';
import type { DashboardStats } from '../types';

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
  loading?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color, subtitle, loading }) => (
  <Paper
    elevation={0}
    sx={{
      p: 3,
      bgcolor: 'rgba(20, 20, 20, 0.8)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 3,
      height: '100%',
      transition: 'all 0.25s ease',
      '&:hover': {
        borderColor: color,
        transform: 'translateY(-4px)',
        boxShadow: `0 8px 24px ${color}20`,
      },
    }}
  >
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ color: 'grey.500', mb: 1, fontSize: 13 }}>
          {title}
        </Typography>
        {loading ? (
          <Skeleton variant="text" width={80} height={40} sx={{ bgcolor: 'grey.800' }} />
        ) : (
          <Typography
            variant="h4"
            sx={{
              fontWeight: 700,
              color: '#fff',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {value}
          </Typography>
        )}
        {subtitle && (
          <Typography variant="caption" sx={{ color: 'grey.600', mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          p: 1.5,
          borderRadius: 2.5,
          bgcolor: `${color}15`,
          color: color,
          ml: 2,
        }}
      >
        {icon}
      </Box>
    </Box>
  </Paper>
);

const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastAddedTitle, setLastAddedTitle] = useState<string>('');
  const [heroTitle, setHeroTitle] = useState<string>('');

  const loadStats = useCallback(async () => {
    try {
      const data = await adminAPI.getStats();
      setStats(data);

      // Fetch last added title from TMDB
      if (data.lastAdded) {
        const details = await tmdbService.getDetails(data.lastAdded.tmdbId, data.lastAdded.type);
        setLastAddedTitle(details?.title || details?.name || 'N/A');
      }

      // Fetch hero title from TMDB
      if (data.currentHero?.contentId) {
        const content = await adminAPI.getContents();
        const heroContent = content.items.find(
          (c) => String(c.tmdbId) === data.currentHero?.contentId
        );
        if (heroContent) {
          const details = await tmdbService.getDetails(heroContent.tmdbId, heroContent.type);
          setHeroTitle(data.currentHero.customTitle || details?.title || details?.name || 'N/A');
        }
      }
    } catch (error) {
      console.error('Errore caricamento statistiche:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress sx={{ color: '#e50914' }} />
      </Box>
    );
  }

  const statsCards = [
    {
      title: 'Totale Contenuti',
      value: stats?.total || 0,
      icon: <LibraryAddIcon />,
      color: '#e50914',
    },
    {
      title: 'Film',
      value: stats?.movies || 0,
      icon: <MovieIcon />,
      color: '#3b82f6',
    },
    {
      title: 'Serie TV',
      value: stats?.tvShows || 0,
      icon: <TvIcon />,
      color: '#8b5cf6',
    },
    {
      title: 'Visibili',
      value: stats?.visible || 0,
      icon: <VisibilityIcon />,
      color: '#22c55e',
    },
    {
      title: 'Non Visibili',
      value: stats?.hidden || 0,
      icon: <VisibilityOffIcon />,
      color: '#f59e0b',
    },
    {
      title: 'Hero Attuale',
      value: heroTitle || 'Non impostato',
      icon: <ViewCarouselIcon />,
      color: '#06b6d4',
    },
    {
      title: 'Ultimo Aggiunto',
      value: lastAddedTitle || 'Nessuno',
      icon: <AccessTimeIcon />,
      color: '#ec4899',
      subtitle: stats?.lastAdded
        ? new Date(stats.lastAdded.createdAt).toLocaleDateString('it-IT', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : undefined,
    },
  ];

  return (
    <Box data-testid="dashboard-page">
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 4, color: '#fff' }}>
        Panoramica
      </Typography>

      <Grid container spacing={3}>
        {statsCards.map((card, index) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={index}>
            <StatCard {...card} loading={loading} />
          </Grid>
        ))}
      </Grid>

      {/* Info Box */}
      <Box sx={{ mt: 5 }}>
        <Paper
          elevation={0}
          sx={{
            p: 4,
            bgcolor: 'rgba(20, 20, 20, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 3,
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: '#fff' }}>
            Guida Rapida
          </Typography>
          <Typography variant="body2" sx={{ color: 'grey.400', lineHeight: 1.8 }}>
            Benvenuto nella dashboard admin. Da qui puoi gestire tutti i contenuti del sito.
          </Typography>
          <Box component="ul" sx={{ color: 'grey.500', mt: 2, pl: 2 }}>
            <li>Usa <strong style={{ color: '#fff' }}>Contenuti</strong> per importare e gestire film/serie da TMDB</li>
            <li>Usa <strong style={{ color: '#fff' }}>Hero Section</strong> per configurare il contenuto in primo piano</li>
            <li>Usa <strong style={{ color: '#fff' }}>Sezioni</strong> per attivare/disattivare e riordinare le categorie</li>
            <li>Controlla i <strong style={{ color: '#fff' }}>Log Attività</strong> per monitorare tutte le modifiche</li>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default DashboardPage;
