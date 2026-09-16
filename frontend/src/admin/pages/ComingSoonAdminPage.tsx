// @ts-nocheck
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import TmdbPicker from './TmdbPicker';
import { api, cardSx, fieldSx, redBtn, fmtDay } from './shared';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w185';

const ComingSoonAdminPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [picked, setPicked] = useState<any>(null);
  const [note, setNote] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [snack, setSnack] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/api/admin/coming-soon').then((d) => setItems(d.items)).catch(() => {});
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await api('/api/admin/coming-soon', { method: 'POST', body: JSON.stringify({ tmdbId: picked.tmdbId, type: picked.type, note, release_date: releaseDate || null }) });
      setSnack({ severity: 'success', message: `"${picked.title}" aggiunto a In Arrivo` }); setPicked(null); setNote(''); setReleaseDate(''); load();
    } catch (e: any) { setSnack({ severity: 'error', message: e.message }); } finally { setBusy(false); }
  };
  const remove = async (it) => { try { await api(`/api/admin/coming-soon/${it.id}`, { method: 'DELETE' }); load(); } catch (e: any) { setSnack({ severity: 'error', message: e.message }); } };

  return (
    <Box data-testid="admin-coming-soon-page">
      <Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 800, mb: 0.5 }}>In Arrivo (curata)</Typography>
      <Typography sx={{ color: 'grey.500', fontSize: 13.5, mb: 3 }}>Titoli scelti dalla redazione. Se la lista è vuota, la sezione "In arrivo" mostra le prossime uscite TMDB.</Typography>
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '380px 1fr' }, alignItems: 'start' }}>
        <Box sx={{ ...cardSx, p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography sx={{ color: '#fff', fontWeight: 700 }}>Aggiungi titolo</Typography>
          {picked ? (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', p: 1, borderRadius: 2, bgcolor: 'rgba(229,9,20,0.1)', border: '1px solid rgba(229,9,20,0.35)' }} data-testid="coming-soon-picked">
              <Box sx={{ width: 40, height: 60, borderRadius: 1, overflow: 'hidden', bgcolor: '#222' }}>{picked.poster_path && <img src={`${TMDB_IMG}${picked.poster_path}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{picked.title}</Typography><Typography sx={{ color: 'grey.400', fontSize: 12 }}>{picked.type === 'tv' ? 'Serie' : 'Film'} · {picked.release_date}</Typography></Box>
              <Button size="small" onClick={() => setPicked(null)} sx={{ color: 'grey.400', textTransform: 'none' }}>Cambia</Button>
            </Box>
          ) : <TmdbPicker onPick={setPicked} testId="coming-soon-picker" />}
          <TextField size="small" label="Nota (es. 'Dal 12 ottobre in esclusiva')" value={note} onChange={(e) => setNote(e.target.value)} inputProps={{ 'data-testid': 'coming-soon-note-input', maxLength: 200 }} sx={fieldSx} />
          <TextField size="small" type="date" label="Data uscita (override)" InputLabelProps={{ shrink: true }} value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} inputProps={{ 'data-testid': 'coming-soon-date-input' }} sx={fieldSx} />
          <Button variant="contained" disabled={!picked || busy} onClick={add} data-testid="coming-soon-add-button" sx={redBtn}>Aggiungi a In Arrivo</Button>
        </Box>
        <Box sx={{ ...cardSx, p: 2.5 }}>
          <Typography sx={{ color: '#fff', fontWeight: 700, mb: 2 }}>Selezione attuale ({items.length})</Typography>
          {items.length === 0 ? <Typography sx={{ color: 'grey.600', fontSize: 14 }} data-testid="coming-soon-empty">Nessun titolo curato: fallback automatico su TMDB.</Typography> : (
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
              {items.map((it) => (
                <Box key={it.id} data-testid={`coming-soon-item-${it.tmdbId}`} sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden', bgcolor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <Box sx={{ aspectRatio: '2/3' }}>{it.poster_path && <img src={`${TMDB_IMG}${it.poster_path}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}</Box>
                  <Box sx={{ p: 1 }}><Typography noWrap sx={{ color: '#fff', fontSize: 12.5, fontWeight: 600 }}>{it.title}</Typography><Typography sx={{ color: 'grey.500', fontSize: 11 }}>{fmtDay(it.release_date)}</Typography>{it.note && <Typography noWrap sx={{ color: '#ff8a90', fontSize: 11 }}>{it.note}</Typography>}</Box>
                  <Chip size="small" label={it.type === 'tv' ? 'Serie' : 'Film'} sx={{ position: 'absolute', top: 6, left: 6, height: 20, fontSize: 10.5, bgcolor: 'rgba(0,0,0,0.7)', color: '#fff' }} />
                  <IconButton size="small" onClick={() => remove(it)} data-testid={`coming-soon-remove-${it.tmdbId}`} sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(0,0,0,0.7)', color: '#fff', '&:hover': { bgcolor: '#e50914' } }}><DeleteOutlineIcon sx={{ fontSize: 16 }} /></IconButton>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>
      <Snackbar open={Boolean(snack)} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snack && <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} data-testid="coming-soon-snackbar">{snack.message}</Alert>}
      </Snackbar>
    </Box>
  );
};

export default ComingSoonAdminPage;
