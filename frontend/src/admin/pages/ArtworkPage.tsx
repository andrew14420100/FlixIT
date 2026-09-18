// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import BlockIcon from '@mui/icons-material/Block';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { netflixArtworkAPI } from '../services/netflixArtwork';

const contexts = ['home', 'top10', 'hero', 'movie', 'tv', 'search', 'detail'];
const statusLabel: Record<string, string> = {
  auto: 'Auto / non Netflix',
  matched: 'Match automatico',
  manual: 'Match manuale',
  not_netflix: 'NON Netflix',
  uncertain: 'Incerto',
};

function statusColor(status: string) {
  if (status === 'matched' || status === 'manual') return 'success';
  if (status === 'not_netflix') return 'default';
  if (status === 'uncertain') return 'warning';
  return 'info';
}

export default function ArtworkPage() {
  const [config, setConfig] = useState<any>(null);
  const [enabled, setEnabled] = useState(false);
  const [region, setRegion] = useState('IT');
  const [cookies, setCookies] = useState('');
  const [type, setType] = useState('movie');
  const [tmdbId, setTmdbId] = useState('');
  const [netflixId, setNetflixId] = useState('');
  const [context, setContext] = useState('home');
  const [viewport, setViewport] = useState('desktop');
  const [result, setResult] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<any>(null);

  const show = (severity: string, text: string) => setMessage({ severity, text });

  const loadConfig = async () => {
    try {
      const data = await netflixArtworkAPI.getConfig();
      setConfig(data);
      setEnabled(!!data.enabled);
      setRegion(data.region || 'IT');
    } catch (error: any) {
      show('error', error.message);
    }
  };

  const loadRecent = async () => {
    try {
      const data = await netflixArtworkAPI.list();
      setRecent(data.items || []);
    } catch {}
  };

  useEffect(() => {
    loadConfig();
    loadRecent();
  }, []);

  const id = Number(tmdbId || 0);
  const canInspect = Number.isInteger(id) && id > 0;

  const inspect = async (refresh = false) => {
    if (!canInspect) return;
    setLoading(true);
    setMessage(null);
    try {
      const data = await netflixArtworkAPI.preview(type, id, context, viewport, refresh);
      setResult(data);
      setNetflixId(data.netflix_id || '');
      await loadRecent();
    } catch (error: any) {
      show('error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const autoMatch = async () => {
    if (!canInspect) return;
    setLoading(true);
    try {
      const data = await netflixArtworkAPI.autoMatch(type, id);
      setResult(data);
      setNetflixId(data.netflix_id || '');
      show(data.status === 'matched' ? 'success' : 'warning', data.status === 'matched' ? 'Match Netflix verificato.' : 'Nessun match automatico sicuro applicato.');
      await loadRecent();
    } catch (error: any) {
      show('error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const manualMatch = async () => {
    if (!canInspect || !netflixId.trim()) return;
    setLoading(true);
    try {
      const data = await netflixArtworkAPI.manualMatch(type, id, netflixId.trim());
      setResult(data);
      show('success', 'Netflix ID associato manualmente.');
      await loadRecent();
    } catch (error: any) {
      show('error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const block = async () => {
    if (!canInspect) return;
    setLoading(true);
    try {
      await netflixArtworkAPI.block(type, id);
      show('success', 'Contenuto marcato NON Netflix. Il matching automatico è bloccato.');
      await inspect(false);
    } catch (error: any) {
      show('error', error.message);
      setLoading(false);
    }
  };

  const resetMatch = async () => {
    if (!canInspect) return;
    setLoading(true);
    try {
      await netflixArtworkAPI.resetMatch(type, id);
      setResult(null);
      setNetflixId('');
      show('success', 'Associazione rimossa. Il contenuto è tornato alla selezione automatica.');
      await loadRecent();
    } catch (error: any) {
      show('error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const forceAsset = async (asset: any) => {
    try {
      await netflixArtworkAPI.setOverride(type, id, {
        context,
        url: asset.url,
        asset_type: asset.type,
        width: asset.width || 0,
        height: asset.height || 0,
      });
      show('success', `Artwork forzato per il contesto “${context}”.`);
      await inspect(false);
    } catch (error: any) {
      show('error', error.message);
    }
  };

  const resetOverride = async () => {
    if (!canInspect) return;
    try {
      await netflixArtworkAPI.resetOverride(type, id, context);
      show('success', `Ripristinata la selezione automatica per “${context}”.`);
      await inspect(false);
    } catch (error: any) {
      show('error', error.message);
    }
  };

  const saveConfig = async () => {
    setLoading(true);
    try {
      const payload: any = { enabled, region };
      if (cookies.trim()) payload.cookies = cookies.trim();
      const data = await netflixArtworkAPI.updateConfig(payload);
      setConfig(data);
      setCookies('');
      show('success', `Configurazione salvata. Artwork pubblico ${data.enabled ? 'ATTIVO' : 'DISATTIVATO'}.`);
    } catch (error: any) {
      show('error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const clearAdminCookies = async () => {
    setLoading(true);
    try {
      const data = await netflixArtworkAPI.updateConfig({ cookies: '' });
      setConfig(data);
      setCookies('');
      show('success', 'Cookie Netflix salvati nell’admin rimossi.');
    } catch (error: any) {
      show('error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    setLoading(true);
    try {
      const data = await netflixArtworkAPI.test();
      show(data.ok ? 'success' : 'error', data.detail || (data.ok ? 'Connessione valida' : 'Connessione non valida'));
      await loadConfig();
    } catch (error: any) {
      show('error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const assets = useMemo(() => result?.assets || [], [result]);

  return (
    <Box data-testid="netflix-artwork-admin">
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ color: '#fff', fontWeight: 800 }}>Artwork Netflix</Typography>
        <Typography sx={{ color: 'grey.500', maxWidth: 1000 }}>
          Resolver modulare per i soli titoli verificati su Netflix Italia. L’integrazione parte disattivata: finché il flag è OFF il sito pubblico continua a usare esattamente gli artwork attuali.
        </Typography>
      </Stack>

      {message && <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: 3 }}>{message.text}</Alert>}

      <Card sx={{ bgcolor: '#151515', color: '#fff', border: '1px solid rgba(255,255,255,.08)', mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Configurazione</Typography>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={3}>
              <FormControlLabel
                control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} color="error" />}
                label={enabled ? 'Artwork pubblico attivo' : 'Artwork pubblico disattivato'}
              />
            </Grid>
            <Grid item xs={12} sm={4} md={2}>
              <TextField fullWidth label="Regione" value={region} onChange={(e) => setRegion(e.target.value.toUpperCase())} inputProps={{ maxLength: 2 }} />
            </Grid>
            <Grid item xs={12} md={7}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="contained" color="error" onClick={saveConfig} disabled={loading}>Salva configurazione</Button>
                <Button variant="outlined" onClick={testConnection} disabled={loading}>Test sessione Netflix</Button>
                {config?.cookie_source === 'admin' && <Button variant="text" color="warning" onClick={clearAdminCookies}>Rimuovi cookie salvati</Button>}
              </Stack>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                type="password"
                label="Cookie della tua sessione Netflix (opzionale)"
                value={cookies}
                onChange={(e) => setCookies(e.target.value)}
                helperText={`Non vengono mai restituiti dal backend. Stato: ${config?.cookie_configured ? `configurati (${config?.cookie_source})` : 'non configurati'}. In produzione è preferibile NETFLIX_COOKIES nell'ambiente.`}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card sx={{ bgcolor: '#151515', color: '#fff', border: '1px solid rgba(255,255,255,.08)', mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Controlla un contenuto</Typography>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={6} sm={2}>
              <TextField select fullWidth label="Tipo" value={type} onChange={(e) => setType(e.target.value)}>
                <MenuItem value="movie">Film</MenuItem>
                <MenuItem value="tv">Serie TV</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField fullWidth label="TMDB ID" value={tmdbId} onChange={(e) => setTmdbId(e.target.value.replace(/\D/g, ''))} />
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField select fullWidth label="Contesto" value={context} onChange={(e) => setContext(e.target.value)}>
                {contexts.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField select fullWidth label="Viewport" value={viewport} onChange={(e) => setViewport(e.target.value)}>
                <MenuItem value="desktop">Desktop</MenuItem>
                <MenuItem value="mobile">Mobile</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Stack direction="row" spacing={1}>
                <Button startIcon={<SearchIcon />} variant="contained" onClick={() => inspect(false)} disabled={!canInspect || loading}>Apri</Button>
                <Button startIcon={<RefreshIcon />} variant="outlined" onClick={autoMatch} disabled={!canInspect || loading}>Ricalcola match</Button>
              </Stack>
            </Grid>
          </Grid>

          {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress color="error" /></Box>}

          {result && !loading && (
            <Box sx={{ mt: 3 }}>
              <Divider sx={{ borderColor: 'rgba(255,255,255,.08)', mb: 2 }} />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                <Chip label={statusLabel[result.status] || result.status} color={statusColor(result.status) as any} />
                <Chip label={`Regione ${result.region || 'IT'}`} variant="outlined" />
                {result.netflix_id && <Chip label={`Netflix ID ${result.netflix_id}`} variant="outlined" />}
                {result.confidence !== undefined && <Chip label={`Confidence ${(Number(result.confidence) * 100).toFixed(0)}%`} variant="outlined" />}
                {result.netflix_title && <Chip label={result.netflix_title} variant="outlined" />}
              </Stack>

              {result.reason && <Typography variant="body2" sx={{ color: 'grey.400', mb: 2 }}>Motivo: {result.reason}</Typography>}
              {result.error && <Alert severity="warning" sx={{ mb: 2 }}>{result.error}</Alert>}

              <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
                <Grid item xs={12} sm={5}>
                  <TextField fullWidth label="Netflix ID manuale" value={netflixId} onChange={(e) => setNetflixId(e.target.value.replace(/\D/g, ''))} />
                </Grid>
                <Grid item xs={12} sm={7}>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button variant="outlined" color="success" startIcon={<CheckCircleIcon />} onClick={manualMatch} disabled={!netflixId}>Associa ID</Button>
                    <Button variant="outlined" color="warning" startIcon={<BlockIcon />} onClick={block}>NON Netflix</Button>
                    <Button variant="text" startIcon={<RestartAltIcon />} onClick={resetMatch}>Ripristina matching automatico</Button>
                    <Button variant="text" onClick={resetOverride}>Ripristina selezione artwork ({context})</Button>
                  </Stack>
                </Grid>
              </Grid>

              {result.artwork?.url && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Selezione corrente per {context}/{viewport}: {result.artwork.type} — {result.artwork.width || '?'}×{result.artwork.height || '?'}.
                </Alert>
              )}

              {assets.length > 0 && (
                <>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>Artwork disponibili</Typography>
                  <Grid container spacing={2}>
                    {assets.map((asset: any, index: number) => {
                      const selected = result.artwork?.url === asset.url;
                      return (
                        <Grid item xs={12} sm={6} lg={4} key={`${asset.url}-${index}`}>
                          <Box sx={{ border: selected ? '2px solid #e50914' : '1px solid rgba(255,255,255,.1)', borderRadius: 2, overflow: 'hidden', bgcolor: '#0b0b0b' }}>
                            <Box component="img" src={asset.url} alt={asset.type} loading="lazy" sx={{ display: 'block', width: '100%', height: 180, objectFit: 'contain', bgcolor: '#050505' }} />
                            <Box sx={{ p: 1.5 }}>
                              <Typography sx={{ fontWeight: 700 }}>{asset.type}</Typography>
                              <Typography variant="caption" sx={{ color: 'grey.500', display: 'block', mb: 1 }}>{asset.width || '?'}×{asset.height || '?'} · {asset.source || 'netflix'}</Typography>
                              <Button size="small" variant={selected ? 'contained' : 'outlined'} color="error" onClick={() => forceAsset(asset)}>Forza per {context}</Button>
                            </Box>
                          </Box>
                        </Grid>
                      );
                    })}
                  </Grid>
                </>
              )}

              {result.candidates?.length > 0 && result.status === 'uncertain' && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Candidati incerti — nessuno viene applicato automaticamente</Typography>
                  <Stack spacing={1}>
                    {result.candidates.map((candidate: any) => (
                      <Box key={candidate.netflix_id} sx={{ p: 1.5, border: '1px solid rgba(255,255,255,.08)', borderRadius: 1 }}>
                        <Typography>{candidate.title} ({candidate.year || '?'})</Typography>
                        <Typography variant="caption" sx={{ color: 'grey.500' }}>Netflix ID {candidate.netflix_id} · score {(Number(candidate.score || 0) * 100).toFixed(0)}%</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      <Card sx={{ bgcolor: '#151515', color: '#fff', border: '1px solid rgba(255,255,255,.08)' }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Ultimi controlli</Typography>
          {recent.length === 0 ? (
            <Typography sx={{ color: 'grey.500' }}>Nessun contenuto controllato.</Typography>
          ) : (
            <Stack spacing={1}>
              {recent.slice(0, 30).map((row: any) => (
                <Box
                  key={`${row.type}-${row.tmdbId}`}
                  onClick={() => { setType(row.type); setTmdbId(String(row.tmdbId)); setTimeout(() => {}, 0); }}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, borderRadius: 1, bgcolor: 'rgba(255,255,255,.025)' }}
                >
                  <Chip size="small" label={statusLabel[row.status] || row.status || 'auto'} color={statusColor(row.status) as any} />
                  <Typography sx={{ minWidth: 90 }}>{row.type} {row.tmdbId}</Typography>
                  <Typography sx={{ color: 'grey.400', flex: 1 }}>{row.netflix_title || row.identity?.title || '—'}</Typography>
                  <Typography variant="caption" sx={{ color: 'grey.600' }}>{row.netflix_id ? `Netflix ${row.netflix_id}` : row.reason || ''}</Typography>
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
