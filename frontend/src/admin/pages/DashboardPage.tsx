// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Skeleton from '@mui/material/Skeleton';
import MovieCreationOutlinedIcon from '@mui/icons-material/MovieCreationOutlined';
import TvOutlinedIcon from '@mui/icons-material/TvOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import ViewCarouselOutlinedIcon from '@mui/icons-material/ViewCarouselOutlined';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import ViewAgendaOutlinedIcon from '@mui/icons-material/ViewAgendaOutlined';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import { adminAPI } from '../services/api';
import { tmdbService } from '../services/tmdb';
import { adminSessionBase } from 'src/utils/adminSession';
import type { DashboardStats } from '../types';

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  subtitle?: string;
  loading?: boolean;
  featured?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, subtitle, loading, featured }) => (
  <Paper
    elevation={0}
    className="fa-stat-card"
    sx={{
      p: { xs: 2.2, md: 2.7 },
      minHeight: 150,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      transition: 'transform 170ms ease, border-color 170ms ease',
      ...(featured ? { background: 'linear-gradient(145deg, rgba(229,9,20,.11), rgba(8,21,35,.96) 45%) !important' } : {}),
    }}
  >
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ color: 'rgba(255,255,255,.48)', fontSize: 12.5, fontWeight: 650, mb: 1.05 }}>
          {title}
        </Typography>
        {loading ? (
          <Skeleton variant="text" width={84} height={42} sx={{ bgcolor: 'rgba(255,255,255,.07)' }} />
        ) : (
          <Typography
            sx={{
              color: '#fff',
              fontWeight: 760,
              fontSize: typeof value === 'number' ? { xs: 29, md: 34 } : { xs: 20, md: 23 },
              lineHeight: 1.08,
              letterSpacing: '-.025em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {value}
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          width: 42,
          height: 42,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          borderRadius: '11px',
          bgcolor: featured ? 'rgba(229,9,20,.14)' : 'rgba(255,255,255,.045)',
          border: featured ? '1px solid rgba(229,9,20,.22)' : '1px solid rgba(151,179,202,.14)',
          color: featured ? '#ff5962' : 'rgba(255,255,255,.68)',
          '& svg': { fontSize: 22 },
        }}
      >
        {icon}
      </Box>
    </Box>
    {subtitle ? (
      <Typography sx={{ color: 'rgba(255,255,255,.36)', fontSize: 11.5, mt: 1.4 }}>{subtitle}</Typography>
    ) : (
      <Box sx={{ mt: 1.4, width: 32, height: 2, bgcolor: featured ? '#e50914' : 'rgba(255,255,255,.12)', borderRadius: 99 }} />
    )}
  </Paper>
);

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { adminSession } = useParams();
  const basePath = adminSessionBase(adminSession);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastAddedTitle, setLastAddedTitle] = useState<string>('');
  const [heroTitle, setHeroTitle] = useState<string>('');

  const loadStats = useCallback(async () => {
    try {
      const data = await adminAPI.getStats();
      setStats(data);

      if (data.lastAdded) {
        const details = await tmdbService.getDetails(data.lastAdded.tmdbId, data.lastAdded.type);
        setLastAddedTitle(details?.title || details?.name || 'N/A');
      }

      if (data.currentHero?.contentId) {
        const content = await adminAPI.getContents();
        const heroContent = content.items.find((c) => String(c.tmdbId) === data.currentHero?.contentId);
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

  useEffect(() => { loadStats(); }, [loadStats]);

  if (loading) {
    return (
      <Box sx={{ minHeight: '58vh', display: 'grid', placeItems: 'center' }} data-testid="dashboard-loading">
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress sx={{ color: '#e50914' }} size={38} />
          <Typography sx={{ color: 'rgba(255,255,255,.42)', fontSize: 12.5, mt: 1.5 }}>Caricamento Control Center…</Typography>
        </Box>
      </Box>
    );
  }

  const visible = Number(stats?.visible || 0);
  const total = Number(stats?.total || 0);
  const visibilityPercent = total > 0 ? Math.round((visible / total) * 100) : 0;

  const statsCards = [
    { title: 'Catalogo totale', value: stats?.total || 0, icon: <LibraryAddOutlinedIcon />, featured: true },
    { title: 'Film', value: stats?.movies || 0, icon: <MovieCreationOutlinedIcon /> },
    { title: 'Serie TV', value: stats?.tvShows || 0, icon: <TvOutlinedIcon /> },
    { title: 'Contenuti visibili', value: stats?.visible || 0, icon: <VisibilityOutlinedIcon />, subtitle: `${visibilityPercent}% del catalogo` },
    { title: 'Non visibili', value: stats?.hidden || 0, icon: <VisibilityOffOutlinedIcon /> },
    { title: 'Hero attuale', value: heroTitle || 'Non impostato', icon: <ViewCarouselOutlinedIcon /> },
    {
      title: 'Ultimo aggiunto',
      value: lastAddedTitle || 'Nessuno',
      icon: <AccessTimeRoundedIcon />,
      subtitle: stats?.lastAdded
        ? new Date(stats.lastAdded.createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
        : undefined,
    },
  ];

  const quickActions = [
    { title: 'Gestisci catalogo', copy: 'Importa, modifica e controlla film e serie TV.', icon: <MovieCreationOutlinedIcon />, path: 'contents' },
    { title: 'Configura Hero', copy: 'Scegli il contenuto principale mostrato nella Home.', icon: <ViewCarouselOutlinedIcon />, path: 'hero' },
    { title: 'Organizza sezioni', copy: 'Attiva, ordina e configura le righe del catalogo.', icon: <ViewAgendaOutlinedIcon />, path: 'sections' },
    { title: 'Controlla attività', copy: 'Visualizza le modifiche registrate dal pannello.', icon: <HistoryRoundedIcon />, path: 'logs' },
  ];

  return (
    <Box data-testid="dashboard-page">
      <section className="fa-dashboard-hero">
        <span className="fa-eyebrow">FlixIT Control Center</span>
        <h1 className="fa-dashboard-title">Tutto sotto controllo.</h1>
        <p className="fa-dashboard-subtitle">
          Catalogo, Premium, utenti e configurazione del sito in un unico spazio costruito con lo stesso linguaggio visivo di FlixIT.
        </p>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2.3 }}>
          <Box sx={{ px: 1.25, py: .65, borderRadius: 99, bgcolor: 'rgba(255,255,255,.055)', border: '1px solid rgba(157,183,205,.16)', color: 'rgba(255,255,255,.70)', fontSize: 11.5, fontWeight: 600 }}>
            {total} contenuti
          </Box>
          <Box sx={{ px: 1.25, py: .65, borderRadius: 99, bgcolor: 'rgba(99,212,135,.07)', border: '1px solid rgba(99,212,135,.15)', color: '#9be8b4', fontSize: 11.5, fontWeight: 700 }}>
            {visibilityPercent}% visibile
          </Box>
        </Box>
      </section>

      <Box sx={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 2, mb: 1.6 }}>
        <Box>
          <Typography sx={{ color: '#fff', fontSize: { xs: 20, md: 23 }, fontWeight: 740, letterSpacing: '-.02em' }}>Panoramica</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,.42)', fontSize: 12.5, mt: .35 }}>Stato attuale della piattaforma</Typography>
        </Box>
      </Box>

      <Grid container spacing={1.8}>
        {statsCards.map((card, index) => (
          <Grid item xs={12} sm={6} md={4} xl={index === 0 ? 3 : 3} key={card.title}>
            <StatCard {...card} loading={false} />
          </Grid>
        ))}
      </Grid>

      <Box sx={{ mt: { xs: 3, md: 4.2 } }}>
        <Box sx={{ mb: 1.6 }}>
          <Typography sx={{ color: '#fff', fontSize: { xs: 20, md: 23 }, fontWeight: 740, letterSpacing: '-.02em' }}>Accesso rapido</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,.42)', fontSize: 12.5, mt: .35 }}>Le aree che usi più spesso</Typography>
        </Box>

        <Paper elevation={0} sx={{ p: { xs: 1.4, md: 1.6 } }}>
          <div className="fa-quick-grid">
            {quickActions.map((action) => (
              <Box
                key={action.title}
                component="button"
                type="button"
                onClick={() => navigate(`${basePath}/${action.path}`)}
                className="fa-quick-item"
                sx={{
                  appearance: 'none',
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'inherit',
                  transition: 'transform 160ms ease, border-color 160ms ease, background-color 160ms ease',
                  '&:hover': { transform: 'translateY(-2px)', borderColor: 'rgba(229,9,20,.28)', bgcolor: 'rgba(255,255,255,.05)' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.3 }}>
                  <Box sx={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: '10px', bgcolor: 'rgba(229,9,20,.11)', color: '#ff5962', '& svg': { fontSize: 21 } }}>
                    {action.icon}
                  </Box>
                  <ArrowForwardRoundedIcon sx={{ fontSize: 18, color: 'rgba(255,255,255,.26)' }} />
                </Box>
                <div className="fa-quick-title">{action.title}</div>
                <div className="fa-quick-copy">{action.copy}</div>
              </Box>
            ))}
          </div>
        </Paper>
      </Box>
    </Box>
  );
};

export default DashboardPage;
