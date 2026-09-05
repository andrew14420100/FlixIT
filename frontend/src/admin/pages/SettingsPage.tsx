// @ts-nocheck
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('admin_token')}`, 'Content-Type': 'application/json' });

const SettingsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scBaseUrl, setScBaseUrl] = useState('');
  const [vixsrc, setVixsrc] = useState<any>({});
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  const load = async () => {
    try {
      const res = await fetch('/api/admin/settings', { headers: authHeaders() });
      if (!res.ok) throw new Error('Errore caricamento impostazioni');
      const data = await res.json();
      setScBaseUrl(data.sc_base_url || '');
      setVixsrc(data.vixsrc || {});
    } catch (e: any) {
      setSnack({ open: true, message: e.message, severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ sc_base_url: scBaseUrl }) });
      if (!res.ok) throw new Error('Salvataggio fallito');
      setSnack({ open: true, message: 'Impostazioni salvate', severity: 'success' });
    } catch (e: any) {
      setSnack({ open: true, message: e.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const refreshCatalog = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/settings/refresh-catalog', { method: 'POST', headers: authHeaders() });
      if (!res.ok) throw new Error('Aggiornamento catalogo fallito');
      await load();
      setSnack({ open: true, message: 'Catalogo vixsrc aggiornato', severity: 'success' });
    } catch (e: any) {
      setSnack({ open: true, message: e.message, severity: 'error' });
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>;

  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('it-IT') : 'mai');

  return (
    <Box data-testid="admin-settings-page">
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>Impostazioni</Typography>
      <Typography sx={{ color: 'text.secondary', mb: 4 }}>Sorgenti esterne: catalogo vixsrc e trailer StreamingCommunity.</Typography>

      <Stack spacing={3}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>Catalogo vixsrc.to</Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 14, mb: 2 }}>
            Nel sito vengono mostrati solo i titoli presenti su vixsrc (eccetto la riga "In arrivo"). Il catalogo si aggiorna ogni 12 ore.
          </Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center" useFlexGap>
            <Chip icon={<MovieIcon />} label={`Film: ${vixsrc.movie?.count ?? 0}`} data-testid="vixsrc-movie-count" />
            <Chip icon={<TvIcon />} label={`Serie TV: ${vixsrc.tv?.count ?? 0}`} data-testid="vixsrc-tv-count" />
            <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>Ultimo aggiornamento: {fmt(vixsrc.movie?.updated_at)}</Typography>
            <Button variant="outlined" startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={refreshCatalog} disabled={refreshing} data-testid="refresh-catalog-button">
              Aggiorna ora
            </Button>
          </Stack>
        </Paper>

        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>Trailer da StreamingCommunity</Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 14, mb: 2 }}>
            Inserisci il dominio attuale di StreamingCommunity (cambia spesso). I trailer verranno letti dalle loro pagine titolo; se vuoto o non raggiungibile si usano i trailer TMDB.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              fullWidth size="small" label="Dominio StreamingCommunity" placeholder="https://streamingunity.xxx"
              value={scBaseUrl} onChange={(e) => setScBaseUrl(e.target.value)}
              inputProps={{ 'data-testid': 'sc-base-url-input' }}
            />
            <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />} onClick={save} disabled={saving} data-testid="save-settings-button" sx={{ whiteSpace: 'nowrap' }}>
              Salva
            </Button>
          </Stack>
        </Paper>
      </Stack>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
};

export default SettingsPage;
