// @ts-nocheck
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import { api, cardSx, dialogPaper, fieldSx, redBtn } from './shared';

const EMPTY = {
  name: '',
  video_url: '',
  click_url: '',
  active: true,
  order: 0,
  starts_at: '',
  ends_at: '',
};

const AdsPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [snack, setSnack] = useState<any>(null);

  const load = async () => {
    try {
      const data = await api('/api/admin/ads');
      setItems(data.items || []);
    } catch (e: any) {
      setSnack({ severity: 'error', message: e?.message || 'Impossibile caricare le pubblicità' });
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => setForm({ ...EMPTY });
  const openEdit = (item) => setForm({
    ...EMPTY,
    ...item,
    starts_at: item.starts_at ? String(item.starts_at).slice(0, 16) : '',
    ends_at: item.ends_at ? String(item.ends_at).slice(0, 16) : '',
  });

  const payload = () => ({
    name: String(form?.name || '').trim(),
    video_url: String(form?.video_url || '').trim(),
    click_url: String(form?.click_url || '').trim(),
    active: Boolean(form?.active),
    order: Number(form?.order || 0),
    starts_at: form?.starts_at ? new Date(form.starts_at).toISOString() : null,
    ends_at: form?.ends_at ? new Date(form.ends_at).toISOString() : null,
  });

  const uploadVideo = async (file: File | null) => {
    if (!file) return;
    const ext = String(file.name || '').split('.').pop()?.toLowerCase();
    if (!['mp4', 'webm', 'm4v', 'mov'].includes(ext || '')) {
      setSnack({ severity: 'warning', message: 'Formato non supportato. Usa MP4, WebM, M4V o MOV.' });
      return;
    }
    if (file.size > 150 * 1024 * 1024) {
      setSnack({ severity: 'warning', message: 'Il video supera 150 MB.' });
      return;
    }

    setUploading(true);
    try {
      const response = await fetch('/api/admin/ads/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name || 'pubblicita.mp4'),
        },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Caricamento video fallito');
      setForm((current) => ({ ...(current || EMPTY), video_url: data.url }));
      setSnack({ severity: 'success', message: 'Video caricato. Verrà riprodotto direttamente nel player FlixIT.' });
    } catch (e: any) {
      setSnack({ severity: 'error', message: e?.message || 'Caricamento video fallito' });
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!form?.name?.trim() || !form?.video_url?.trim()) {
      setSnack({ severity: 'warning', message: 'Inserisci il nome e carica un video oppure usa un URL video diretto.' });
      return;
    }
    setBusy(true);
    try {
      await api(form.id ? `/api/admin/ads/${form.id}` : '/api/admin/ads', {
        method: form.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload()),
      });
      setSnack({ severity: 'success', message: form.id ? 'Campagna aggiornata' : 'Campagna creata' });
      setForm(null);
      await load();
    } catch (e: any) {
      setSnack({ severity: 'error', message: e?.message || 'Salvataggio fallito' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item) => {
    try {
      await api(`/api/admin/ads/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: item.name,
          video_url: item.video_url,
          click_url: item.click_url || '',
          active: !item.active,
          order: Number(item.order || 0),
          starts_at: item.starts_at || null,
          ends_at: item.ends_at || null,
        }),
      });
      await load();
    } catch (e: any) {
      setSnack({ severity: 'error', message: e?.message || 'Aggiornamento fallito' });
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Eliminare la campagna “${item.name}”?`)) return;
    try {
      await api(`/api/admin/ads/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setSnack({ severity: 'error', message: e?.message || 'Eliminazione fallita' });
    }
  };

  return (
    <Box data-testid="admin-ads-page">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Box>
          <Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>Pubblicità</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,.46)', fontSize: 13.5, mt: .5, maxWidth: 760 }}>
            Il piano gratuito mostra 2 pubblicità per contenuto: una prima della riproduzione e una a metà. Base ne mostra 1 all'inizio; Pro e Unlimited non mostrano pubblicità.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openNew} sx={redBtn}>Nuova campagna</Button>
      </Box>

      <Box sx={{ ...cardSx, p: 2, mb: 2.5, display: 'flex', alignItems: 'center', gap: 1.2, flexWrap: 'wrap' }}>
        <CampaignOutlinedIcon sx={{ color: '#ff5962' }} />
        <Chip size="small" label="GRATUITO · 2 ADS" sx={{ bgcolor: 'rgba(229,9,20,.12)', color: '#ff6971', fontWeight: 800 }} />
        <Chip size="small" label="BASE · 1 AD" sx={{ bgcolor: 'rgba(255,255,255,.06)', color: '#fff' }} />
        <Chip size="small" label="PRO · 0 ADS" sx={{ bgcolor: 'rgba(255,255,255,.06)', color: '#fff' }} />
        <Chip size="small" label="UNLIMITED · 0 ADS" sx={{ bgcolor: 'rgba(255,255,255,.06)', color: '#fff' }} />
      </Box>

      {items.length === 0 ? (
        <Box sx={{ ...cardSx, minHeight: 260, display: 'grid', placeItems: 'center', textAlign: 'center', px: 3 }}>
          <Box>
            <PlayCircleOutlineRoundedIcon sx={{ color: 'rgba(255,255,255,.25)', fontSize: 54, mb: 1.5 }} />
            <Typography sx={{ color: '#fff', fontWeight: 750, fontSize: 17 }}>Nessuna campagna configurata</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,.42)', fontSize: 13.5, mt: .7 }}>Carica un MP4/WebM: verrà riprodotto dal player FlixIT senza iframe o controlli di servizi esterni.</Typography>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2,minmax(0,1fr))' }, gap: 2 }}>
          {items.map((item) => (
            <Box key={item.id} sx={{ ...cardSx, p: 2.2, opacity: item.active ? 1 : .58 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px 1fr' }, gap: 2 }}>
                <Box sx={{ borderRadius: '10px', overflow: 'hidden', bgcolor: '#000', aspectRatio: '16 / 9', border: '1px solid rgba(255,255,255,.08)' }}>
                  <video src={item.video_url} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography noWrap sx={{ color: '#fff', fontSize: 16.5, fontWeight: 750 }}>{item.name}</Typography>
                      <Typography noWrap sx={{ color: 'rgba(255,255,255,.38)', fontSize: 12, mt: .4 }}>{item.video_url}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', height: 32 }}>
                      <IconButton size="small" onClick={() => openEdit(item)} sx={{ color: 'rgba(255,255,255,.64)' }}><EditRoundedIcon fontSize="small" /></IconButton>
                      <IconButton size="small" onClick={() => remove(item)} sx={{ color: '#ff6971' }}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
                    </Box>
                  </Box>
                  {item.click_url ? (
                    <Button size="small" endIcon={<OpenInNewRoundedIcon />} href={item.click_url} target="_blank" rel="noreferrer" sx={{ mt: 1, px: 0, color: 'rgba(255,255,255,.62)', textTransform: 'none' }}>Link campagna</Button>
                  ) : null}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1.1 }}>
                    <Typography sx={{ color: 'rgba(255,255,255,.44)', fontSize: 12.5 }}>Ordine {Number(item.order || 0)}</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: .6 }}><Typography sx={{ color: 'rgba(255,255,255,.5)', fontSize: 12 }}>{item.active ? 'Attiva' : 'Disattiva'}</Typography><Switch size="small" checked={Boolean(item.active)} onChange={() => toggle(item)} /></Box>
                  </Box>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Dialog open={Boolean(form)} onClose={() => !busy && !uploading && setForm(null)} PaperProps={{ ...dialogPaper, sx: { ...(dialogPaper?.sx || {}), width: 'min(680px, calc(100% - 28px))' } }}>
        <DialogTitle sx={{ color: '#fff', fontWeight: 800 }}>{form?.id ? 'Modifica campagna' : 'Nuova campagna'}</DialogTitle>
        {form ? <DialogContent sx={{ pt: '10px !important' }}>
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField label="Nome campagna" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} sx={fieldSx} fullWidth />

            <Box sx={{ ...cardSx, p: 2, display: 'grid', gap: 1.4 }}>
              <Box>
                <Typography sx={{ color: '#fff', fontSize: 14, fontWeight: 750 }}>Video pubblicitario nel player FlixIT</Typography>
                <Typography sx={{ color: 'rgba(255,255,255,.45)', fontSize: 12.5, mt: .4 }}>
                  Carica direttamente il file della pubblicità. YouTube non può essere riprodotto nel player nativo senza usare il player YouTube.
                </Typography>
              </Box>
              <Button
                component="label"
                variant="outlined"
                disabled={uploading}
                startIcon={uploading ? <CircularProgress size={17} /> : <CloudUploadRoundedIcon />}
                sx={{ justifySelf: 'start', color: '#fff', borderColor: 'rgba(255,255,255,.22)', textTransform: 'none', borderRadius: 2 }}
              >
                {uploading ? 'Caricamento…' : 'Carica MP4 / WebM'}
                <input
                  hidden
                  type="file"
                  accept="video/mp4,video/webm,video/x-m4v,video/quicktime,.mp4,.webm,.m4v,.mov"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    e.target.value = '';
                    uploadVideo(file);
                  }}
                />
              </Button>
              {form.video_url ? (
                <Box sx={{ borderRadius: '10px', overflow: 'hidden', bgcolor: '#000', aspectRatio: '16 / 9', border: '1px solid rgba(255,255,255,.10)' }}>
                  <video key={form.video_url} src={form.video_url} controls preload="metadata" playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                </Box>
              ) : null}
            </Box>

            <TextField
              label="Oppure URL video diretto"
              value={form.video_url}
              onChange={(e) => setForm({ ...form, video_url: e.target.value })}
              helperText="Solo URL diretti a video riproducibili dal browser. I link youtube.com / youtu.be non sono supportati dal player nativo."
              sx={fieldSx}
              fullWidth
            />
            <TextField label="Link campagna (facoltativo)" value={form.click_url} onChange={(e) => setForm({ ...form, click_url: e.target.value })} sx={fieldSx} fullWidth />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField type="number" label="Ordine" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value || 0) })} sx={fieldSx} />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.6, borderRadius: '10px', border: '1px solid rgba(255,255,255,.10)' }}><Typography sx={{ color: '#fff', fontSize: 13.5 }}>Campagna attiva</Typography><Switch checked={Boolean(form.active)} onChange={(e) => setForm({ ...form, active: e.target.checked })} /></Box>
              <TextField type="datetime-local" label="Inizio (facoltativo)" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} InputLabelProps={{ shrink: true }} sx={fieldSx} />
              <TextField type="datetime-local" label="Fine (facoltativo)" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} InputLabelProps={{ shrink: true }} sx={fieldSx} />
            </Box>
          </Box>
        </DialogContent> : null}
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button disabled={busy || uploading} onClick={() => setForm(null)} sx={{ color: 'rgba(255,255,255,.54)', textTransform: 'none' }}>Annulla</Button>
          <Button disabled={busy || uploading} onClick={save} variant="contained" sx={redBtn}>{busy ? 'Salvataggio…' : 'Salva campagna'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(snack)} autoHideDuration={4200} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : null}
      </Snackbar>
    </Box>
  );
};

export default AdsPage;
