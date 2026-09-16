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
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
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
  const [publicDomainFallback, setPublicDomainFallback] = useState(false);
  const [streamSourcesCount, setStreamSourcesCount] = useState(0);
  const [togglingFallback, setTogglingFallback] = useState(false);
  const [mfUrl, setMfUrl] = useState('');
  const [mfPassword, setMfPassword] = useState('');
  const [mfEnabled, setMfEnabled] = useState(true);
  const [mfActive, setMfActive] = useState(false);
  const [mfSaving, setMfSaving] = useState(false);
  const [mfTesting, setMfTesting] = useState(false);
  const [mfTest, setMfTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [stUrl, setStUrl] = useState('');
  const [stEnabled, setStEnabled] = useState(true);
  const [stActive, setStActive] = useState(false);
  const [stSaving, setStSaving] = useState(false);
  const [stTesting, setStTesting] = useState(false);
  const [stTest, setStTest] = useState<any>(null);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  const load = async () => {
    try {
      const res = await fetch('/api/admin/settings', { headers: authHeaders() });
      if (!res.ok) throw new Error('Errore caricamento impostazioni');
      const data = await res.json();
      setScBaseUrl(data.sc_base_url || '');
      setVixsrc(data.vixsrc || {});
      setPublicDomainFallback(!!data.public_domain_fallback);
      setStreamSourcesCount(data.stream_sources_count || 0);
      setMfUrl(data.mediaflow_url || '');
      setMfPassword(data.mediaflow_api_password || '');
      setMfEnabled(data.mediaflow_enabled !== false);
      setMfActive(!!data.mediaflow_active);
      setStUrl(data.stremio_addon_url || '');
      setStEnabled(data.stremio_enabled !== false);
      setStActive(!!data.stremio_active);
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

  const toggleFallback = async (checked: boolean) => {
    setTogglingFallback(true);
    setPublicDomainFallback(checked);
    try {
      const res = await fetch('/api/admin/settings', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ public_domain_fallback: checked }) });
      if (!res.ok) throw new Error('Salvataggio fallito');
      setSnack({ open: true, message: checked ? 'Fallback pubblico dominio attivato' : 'Fallback pubblico dominio disattivato', severity: 'success' });
    } catch (e: any) {
      setPublicDomainFallback(!checked);
      setSnack({ open: true, message: e.message, severity: 'error' });
    } finally {
      setTogglingFallback(false);
    }
  };

  const saveMediaflow = async (enabledOverride?: boolean) => {
    setMfSaving(true);
    const enabled = enabledOverride ?? mfEnabled;
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ mediaflow_url: mfUrl.trim(), mediaflow_api_password: mfPassword, mediaflow_enabled: enabled }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || 'Salvataggio fallito');
      const data = await res.json();
      setMfUrl(data.mediaflow_url || '');
      setMfEnabled(data.mediaflow_enabled !== false);
      setMfActive(!!data.mediaflow_active);
      setSnack({ open: true, message: data.mediaflow_active ? 'MediaFlow Proxy attivo: gli stream verranno instradati tramite il proxy' : 'MediaFlow salvato (proxy disattivo: stream diretti)', severity: 'success' });
    } catch (e: any) {
      setSnack({ open: true, message: e.message, severity: 'error' });
    } finally {
      setMfSaving(false);
    }
  };

  const testMediaflow = async () => {
    setMfTesting(true);
    setMfTest(null);
    try {
      const res = await fetch('/api/admin/settings/mediaflow/test', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ mediaflow_url: mfUrl.trim(), mediaflow_api_password: mfPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Test fallito');
      setMfTest({ ok: !!data.ok, detail: data.detail });
    } catch (e: any) {
      setMfTest({ ok: false, detail: e.message });
    } finally {
      setMfTesting(false);
    }
  };

  const saveStremio = async (enabledOverride?: boolean) => {
    setStSaving(true);
    const enabled = enabledOverride ?? stEnabled;
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ stremio_addon_url: stUrl.trim(), stremio_enabled: enabled }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || 'Salvataggio fallito');
      const data = await res.json();
      setStUrl(data.stremio_addon_url || '');
      setStEnabled(data.stremio_enabled !== false);
      setStActive(!!data.stremio_active);
      setSnack({ open: true, message: data.stremio_active ? 'Addon Stremio attivo nella catena del player' : 'Addon Stremio salvato (disattivo)', severity: 'success' });
    } catch (e: any) {
      setSnack({ open: true, message: e.message, severity: 'error' });
    } finally {
      setStSaving(false);
    }
  };

  const testStremio = async () => {
    setStTesting(true);
    setStTest(null);
    try {
      const res = await fetch('/api/admin/settings/stremio/test', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ stremio_addon_url: stUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Test fallito');
      setStTest(data);
    } catch (e: any) {
      setStTest({ ok: false, detail: e.message });
    } finally {
      setStTesting(false);
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
      <Typography sx={{ color: 'text.secondary', mb: 4 }}>Player nativo, MediaFlow Proxy, addon Stremio, catalogo vixsrc e trailer StreamingCommunity.</Typography>

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

        <Paper sx={{ p: 3 }} data-testid="player-settings-card">
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>Player nativo</Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 14, mb: 2 }}>
            Il player riproduce solo gli stream configurati da Admin &gt; Contenuti (icona <PlayCircleOutlineIcon sx={{ fontSize: 16, verticalAlign: 'middle' }} />). Se un titolo non ha una sorgente viene mostrato "Stream non disponibile".
          </Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center" useFlexGap>
            <Chip icon={<PlayCircleOutlineIcon />} label={`Stream configurati: ${streamSourcesCount}`} data-testid="stream-sources-count" />
            <FormControlLabel
              control={
                <Switch
                  checked={publicDomainFallback}
                  onChange={(e) => toggleFallback(e.target.checked)}
                  disabled={togglingFallback}
                  color="error"
                  inputProps={{ 'data-testid': 'public-domain-fallback-switch' }}
                />
              }
              label={<Typography sx={{ fontSize: 14 }}>Fallback pubblico dominio (Internet Archive) - {publicDomainFallback ? 'attivo' : 'disattivo'}</Typography>}
            />
          </Stack>
          <Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 1 }}>
            Se attivo, per i titoli senza sorgente admin il player cerca una copia di pubblico dominio su Internet Archive (corrispondenza esatta di titolo e anno). Predefinito: disattivo.
          </Typography>
        </Paper>

        <Paper sx={{ p: 3 }} data-testid="mediaflow-settings-card">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>MediaFlow Proxy</Typography>
            <Chip
              size="small"
              color={mfActive ? 'success' : 'default'}
              label={mfActive ? 'Attivo' : 'Disattivo - stream diretti'}
              data-testid="mediaflow-status-chip"
            />
          </Stack>
          <Typography sx={{ color: 'text.secondary', fontSize: 14, mb: 2 }}>
            Se configurato, ogni stream risolto dal player viene incapsulato e instradato tramite il proxy
            (<code>/proxy/hls/manifest.m3u8</code> per HLS, <code>/proxy/stream</code> per MP4). Se l'URL è vuoto o il proxy è disattivo il player usa l'URL originale.
          </Typography>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth size="small" label="URL MediaFlow Proxy" placeholder="https://mediaflow.tuodominio.it"
                value={mfUrl} onChange={(e) => { setMfUrl(e.target.value); setMfTest(null); }}
                inputProps={{ 'data-testid': 'mediaflow-url-input' }}
              />
              <TextField
                size="small" label="API password (opzionale)" type="password" autoComplete="new-password"
                value={mfPassword} onChange={(e) => { setMfPassword(e.target.value); setMfTest(null); }}
                inputProps={{ 'data-testid': 'mediaflow-password-input' }}
                sx={{ minWidth: { sm: 260 } }}
              />
            </Stack>
            <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center" useFlexGap>
              <FormControlLabel
                control={
                  <Switch
                    checked={mfEnabled}
                    onChange={(e) => { setMfEnabled(e.target.checked); saveMediaflow(e.target.checked); }}
                    disabled={mfSaving}
                    color="error"
                    inputProps={{ 'data-testid': 'mediaflow-enabled-switch' }}
                  />
                }
                label={<Typography sx={{ fontSize: 14 }}>Instrada gli stream tramite MediaFlow</Typography>}
              />
              <Button variant="outlined" onClick={testMediaflow} disabled={mfTesting || !mfUrl.trim()} startIcon={mfTesting ? <CircularProgress size={16} /> : <RefreshIcon />} data-testid="mediaflow-test-button">
                Testa connessione
              </Button>
              <Button variant="contained" onClick={() => saveMediaflow()} disabled={mfSaving} startIcon={mfSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />} data-testid="mediaflow-save-button">
                Salva
              </Button>
            </Stack>
            {mfTest && (
              <Alert severity={mfTest.ok ? 'success' : 'warning'} data-testid="mediaflow-test-result">{mfTest.detail}</Alert>
            )}
          </Stack>
        </Paper>

        <Paper sx={{ p: 3 }} data-testid="stremio-settings-card">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>Addon Stremio</Typography>
            <Chip size="small" color={stActive ? 'success' : 'default'} label={stActive ? 'Attivo' : 'Disattivo'} data-testid="stremio-status-chip" />
          </Stack>
          <Typography sx={{ color: 'text.secondary', fontSize: 14, mb: 2 }}>
            Il player interroga l'addon (protocollo Stremio, <code>/stream/&#123;movie|series&#125;/&#123;imdb&#125;.json</code>) per i titoli senza sorgente admin.
            Vengono usati solo stream con URL http(s); se MediaFlow è attivo vengono instradati tramite proxy. Usa solo addon di cui hai diritto d'uso.
          </Typography>
          <Stack spacing={2}>
            <TextField
              fullWidth size="small" label="URL addon Stremio" placeholder="https://mio-addon.example.com/manifest.json"
              value={stUrl} onChange={(e) => { setStUrl(e.target.value); setStTest(null); }}
              inputProps={{ 'data-testid': 'stremio-url-input' }}
            />
            <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center" useFlexGap>
              <FormControlLabel
                control={
                  <Switch
                    checked={stEnabled}
                    onChange={(e) => { setStEnabled(e.target.checked); saveStremio(e.target.checked); }}
                    disabled={stSaving}
                    color="error"
                    inputProps={{ 'data-testid': 'stremio-enabled-switch' }}
                  />
                }
                label={<Typography sx={{ fontSize: 14 }}>Usa l'addon nella catena del player</Typography>}
              />
              <Button variant="outlined" onClick={testStremio} disabled={stTesting || !stUrl.trim()} startIcon={stTesting ? <CircularProgress size={16} /> : <RefreshIcon />} data-testid="stremio-test-button">
                Testa addon
              </Button>
              <Button variant="contained" onClick={() => saveStremio()} disabled={stSaving} startIcon={stSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />} data-testid="stremio-save-button">
                Salva
              </Button>
            </Stack>
            {stTest && (
              <Alert severity={stTest.ok ? 'success' : 'warning'} data-testid="stremio-test-result">
                {stTest.detail}
                {stTest.ok && (
                  <Typography component="span" sx={{ display: 'block', fontSize: 12, mt: 0.5 }}>
                    Tipi: {(stTest.types || []).join(', ') || '-'} · Prefissi id: {(stTest.id_prefixes || []).join(', ') || 'tt'} · Risorsa stream: {stTest.supports_stream ? 'sì' : 'no'}
                  </Typography>
                )}
              </Alert>
            )}
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
