// @ts-nocheck
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import TmdbPicker from './TmdbPicker';
import { api, cardSx, fieldSx, redBtn, ghostBtn } from './shared';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w154';
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const emptyPage = { title: '', slug: '', description: '', access: 'premium', active: true, order: 0, hero: { title: '', description: '', image: '', trailer_key: '', cta_label: 'Scopri la selezione', cta_link: '#sezioni' }, sections: [{ id: null, title: 'In evidenza', items: [] }] };

function SectionEditor({ section, index, onChange, onRemove }) {
  const add = (r) => { if (section.items.some((i) => i.tmdbId === r.tmdbId && i.type === r.type)) return; onChange({ ...section, items: [...section.items, { tmdbId: r.tmdbId, type: r.type, title: r.title, poster_path: r.poster_path }] }); };
  const remove = (idx) => onChange({ ...section, items: section.items.filter((_, i) => i !== idx) });
  return (
    <Box sx={{ ...cardSx, p: 2, bgcolor: 'rgba(255,255,255,0.02)' }} data-testid={`page-section-${index}`}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 1.5 }}>
        <TextField size="small" fullWidth label={`Titolo sezione ${index + 1}`} value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} inputProps={{ 'data-testid': `page-section-title-${index}` }} sx={fieldSx} />
        <IconButton onClick={onRemove} data-testid={`page-section-remove-${index}`} sx={{ color: '#ff5a63' }}><DeleteOutlineIcon /></IconButton>
      </Box>
      <TmdbPicker onPick={add} testId={`page-section-picker-${index}`} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
        {section.items.map((it, idx) => { const meta = it; return (
          <Box key={`${it.type}-${it.tmdbId}`} data-testid={`page-section-item-${index}-${it.tmdbId}`} sx={{ position: 'relative', width: 72, borderRadius: 1.5, overflow: 'hidden', bgcolor: '#222' }}>
            <Box sx={{ aspectRatio: '2/3' }}>{meta.poster_path && <img src={`${TMDB_IMG}${meta.poster_path}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}</Box>
            <Typography noWrap sx={{ fontSize: 10.5, px: 0.5, py: 0.3, color: '#ddd' }}>{meta.title || it.tmdbId}</Typography>
            <IconButton size="small" onClick={() => remove(idx)} sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(0,0,0,0.7)', color: '#fff', p: 0.3, '&:hover': { bgcolor: '#e50914' } }}><CloseIcon sx={{ fontSize: 14 }} /></IconButton>
          </Box>); })}
        {section.items.length === 0 && <Typography sx={{ color: 'grey.600', fontSize: 13 }}>Nessun titolo: cerca sopra per aggiungere.</Typography>}
      </Box>
    </Box>
  );
}

const PremiumPagesPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [snack, setSnack] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/api/admin/premium-pages').then((d) => setItems(d.items)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, order: Number(form.order), sections: form.sections.map((s) => ({ id: s.id, title: s.title, items: s.items.map((i) => ({ tmdbId: i.tmdbId, type: i.type })) })) };
      delete body.id; delete body.createdAt; delete body.updatedAt;
      await api(form.id ? `/api/admin/premium-pages/${form.id}` : '/api/admin/premium-pages', { method: form.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setSnack({ severity: 'success', message: 'Pagina salvata' }); setForm(null); load();
    } catch (e: any) { setSnack({ severity: 'error', message: e.message }); } finally { setBusy(false); }
  };
  const remove = async (p) => { if (!window.confirm(`Eliminare la pagina "${p.title}"?`)) return; try { await api(`/api/admin/premium-pages/${p.id}`, { method: 'DELETE' }); load(); } catch (e: any) { setSnack({ severity: 'error', message: e.message }); } };
  const toggle = async (p) => { try { const body = { ...p, active: !p.active }; delete body.id; delete body.createdAt; delete body.updatedAt; await api(`/api/admin/premium-pages/${p.id}`, { method: 'PUT', body: JSON.stringify(body) }); load(); } catch (e: any) { setSnack({ severity: 'error', message: e.message }); } };
  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setH = (k) => (e) => setForm({ ...form, hero: { ...form.hero, [k]: e.target.value } });

  if (form) return (
    <Box data-testid="premium-page-editor">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>{form.id ? `Modifica: ${form.title}` : 'Nuova pagina Premium'}</Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" onClick={() => setForm(null)} sx={ghostBtn} data-testid="page-cancel">Annulla</Button>
          <Button variant="contained" disabled={busy || !form.title.trim() || !form.slug.trim()} onClick={save} sx={redBtn} data-testid="page-save">Salva pagina</Button>
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        <Box sx={{ ...cardSx, p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography sx={{ color: '#fff', fontWeight: 700 }}>Metadati pagina</Typography>
          <TextField label="Titolo" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, slug: form.id ? form.slug : slugify(e.target.value) })} inputProps={{ 'data-testid': 'page-title-input' }} sx={fieldSx} />
          <TextField label="Slug (URL /p/…)" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} inputProps={{ 'data-testid': 'page-slug-input' }} sx={fieldSx} helperText={`/p/${form.slug || '…'}`} />
          <TextField label="Descrizione" value={form.description} onChange={setF('description')} multiline minRows={2} inputProps={{ 'data-testid': 'page-description-input' }} sx={fieldSx} />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField select label="Permessi di accesso" value={form.access} onChange={setF('access')} inputProps={{ 'data-testid': 'page-access-select' }} sx={fieldSx} fullWidth>
              <MenuItem value="premium">Solo Premium (paywall)</MenuItem><MenuItem value="public">Pubblica (tutti)</MenuItem>
            </TextField>
            <TextField label="Ordine menu" type="number" value={form.order} onChange={setF('order')} inputProps={{ 'data-testid': 'page-order-input' }} sx={fieldSx} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Switch checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="page-active-switch" /><Typography sx={{ color: 'grey.300', fontSize: 14 }}>Pagina attiva</Typography></Box>
        </Box>
        <Box sx={{ ...cardSx, p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography sx={{ color: '#fff', fontWeight: 700 }}>Hero banner</Typography>
          <TextField label="Titolo hero" value={form.hero.title} onChange={setH('title')} inputProps={{ 'data-testid': 'hero-title-input' }} sx={fieldSx} />
          <TextField label="Descrizione hero" value={form.hero.description} onChange={setH('description')} multiline minRows={2} inputProps={{ 'data-testid': 'hero-description-input' }} sx={fieldSx} />
          <TextField label="Immagine (URL)" value={form.hero.image} onChange={setH('image')} inputProps={{ 'data-testid': 'hero-image-input' }} sx={fieldSx} helperText="Vuoto = backdrop del primo titolo della prima sezione" />
          <TextField label="Trailer YouTube (key)" value={form.hero.trailer_key} onChange={setH('trailer_key')} inputProps={{ 'data-testid': 'hero-trailer-input' }} sx={fieldSx} />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField label="Testo CTA" value={form.hero.cta_label} onChange={setH('cta_label')} inputProps={{ 'data-testid': 'hero-cta-label-input' }} sx={fieldSx} fullWidth />
            <TextField label="Link CTA" value={form.hero.cta_link} onChange={setH('cta_link')} inputProps={{ 'data-testid': 'hero-cta-link-input' }} sx={fieldSx} fullWidth helperText="#sezioni, /percorso o https://…" />
          </Box>
        </Box>
      </Box>
      <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ color: '#fff', fontWeight: 700 }}>Griglie / caroselli ({form.sections.length})</Typography>
          <Button startIcon={<AddIcon />} onClick={() => setForm({ ...form, sections: [...form.sections, { id: null, title: '', items: [] }] })} data-testid="page-section-add" sx={{ color: '#ff5a63', textTransform: 'none' }}>Aggiungi sezione</Button>
        </Box>
        {form.sections.map((s, i) => <SectionEditor key={s.id || `new-${i}`} section={s} index={i} onChange={(ns) => setForm({ ...form, sections: form.sections.map((x, j) => (j === i ? ns : x)) })} onRemove={() => setForm({ ...form, sections: form.sections.filter((_, j) => j !== i) })} />)}
      </Box>
      <Snackbar open={Boolean(snack)} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snack && <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert>}
      </Snackbar>
    </Box>
  );

  return (
    <Box data-testid="admin-premium-pages">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box><Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>Pagine Premium</Typography><Typography sx={{ color: 'grey.500', fontSize: 13.5 }}>Struttura fissa (hero + caroselli), contenuti completamente editabili.</Typography></Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm(JSON.parse(JSON.stringify(emptyPage)))} data-testid="page-add-button" sx={redBtn}>Nuova pagina</Button>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
        {items.map((p) => (
          <Box key={p.id} sx={{ ...cardSx, p: 2.5, opacity: p.active ? 1 : 0.55 }} data-testid={`premium-page-row-${p.slug}`}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Box><Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>{p.title}</Typography><Typography sx={{ color: 'grey.500', fontSize: 13 }}>/p/{p.slug} · {p.sections?.length || 0} sezioni · {(p.sections || []).reduce((a, s) => a + (s.items?.length || 0), 0)} titoli</Typography></Box>
              <Chip size="small" label={p.access === 'public' ? 'Pubblica' : 'Premium'} sx={{ bgcolor: p.access === 'public' ? 'rgba(74,222,128,0.15)' : 'rgba(229,9,20,0.2)', color: p.access === 'public' ? '#4ade80' : '#ff5a63', fontWeight: 600, height: 24 }} />
            </Box>
            <Typography sx={{ color: 'grey.400', fontSize: 13.5, mt: 1.5 }}>{p.description}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Switch size="small" checked={Boolean(p.active)} onChange={() => toggle(p)} data-testid={`premium-page-toggle-${p.slug}`} /><Typography sx={{ color: 'grey.400', fontSize: 13 }}>{p.active ? 'Attiva' : 'Disattiva'}</Typography></Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton size="small" component="a" href={`/p/${p.slug}`} target="_blank" sx={{ color: 'grey.400' }}><OpenInNewIcon fontSize="small" /></IconButton>
                <Button size="small" onClick={() => setForm(JSON.parse(JSON.stringify(p)))} data-testid={`premium-page-edit-${p.slug}`} sx={{ color: '#fff', textTransform: 'none' }}>Modifica</Button>
                <IconButton size="small" onClick={() => remove(p)} data-testid={`premium-page-delete-${p.slug}`} sx={{ color: '#ff5a63' }}><DeleteOutlineIcon fontSize="small" /></IconButton>
              </Box>
            </Box>
          </Box>
        ))}
      </Box>
      <Snackbar open={Boolean(snack)} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snack && <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert>}
      </Snackbar>
    </Box>
  );
};

export default PremiumPagesPage;
