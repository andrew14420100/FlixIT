// @ts-nocheck
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import { api, cardSx, dialogPaper, fieldSx, redBtn, ghostBtn, euro } from './shared';

const INTERVALS = [['month', 'Mensile (30 gg)', 30], ['year', 'Annuale (365 gg)', 365], ['lifetime', 'A vita', null], ['custom', 'Durata personalizzata', 90]];
const empty = { name: '', description: '', price_cents: 499, currency: 'EUR', interval: 'month', duration_days: 30, badge: '', features: [], active: true, order: 0 };

const PlansPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [snack, setSnack] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/api/admin/plans').then((d) => setItems(d.items)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, price_cents: Number(form.price_cents), duration_days: form.interval === 'lifetime' ? null : Number(form.duration_days), features: (form.featuresText ?? form.features.join('\n')).split('\n').map((s) => s.trim()).filter(Boolean) };
      delete body.featuresText;
      await api(form.id ? `/api/admin/plans/${form.id}` : '/api/admin/plans', { method: form.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setSnack({ severity: 'success', message: 'Piano salvato' }); setForm(null); load();
    } catch (e: any) { setSnack({ severity: 'error', message: e.message }); } finally { setBusy(false); }
  };
  const remove = async (p) => { if (!window.confirm(`Eliminare il piano ${p.name}?`)) return; try { await api(`/api/admin/plans/${p.id}`, { method: 'DELETE' }); load(); } catch (e: any) { setSnack({ severity: 'error', message: e.message }); } };
  const toggle = async (p) => { try { await api(`/api/admin/plans/${p.id}`, { method: 'PUT', body: JSON.stringify({ ...p, active: !p.active }) }); load(); } catch (e: any) { setSnack({ severity: 'error', message: e.message }); } };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Box data-testid="admin-plans-page">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box><Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>Piani Premium</Typography><Typography sx={{ color: 'grey.500', fontSize: 13.5 }}>Prezzi in EUR, modificabili in qualsiasi momento. I piani disattivi non compaiono nel checkout.</Typography></Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ ...empty, featuresText: '' })} data-testid="plan-add-button" sx={redBtn}>Nuovo piano</Button>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' } }}>
        {items.map((p) => (
          <Box key={p.id} sx={{ ...cardSx, p: 2.5, opacity: p.active ? 1 : 0.55 }} data-testid={`plan-row-${p.id}`}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
              <Box><Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>{p.name} {p.badge && <Chip size="small" label={p.badge} sx={{ ml: 1, bgcolor: 'rgba(229,9,20,0.2)', color: '#ff5a63', fontWeight: 600 }} />}</Typography>
                <Typography sx={{ color: 'grey.500', fontSize: 13 }}>{p.interval === 'lifetime' ? 'A vita' : `${p.duration_days} giorni`} · ordine {p.order}</Typography></Box>
              <Typography data-testid={`plan-row-price-${p.id}`} sx={{ color: '#f5c518', fontWeight: 800, fontSize: 22 }}>{euro(p.price_cents, p.currency)}</Typography>
            </Box>
            <Typography sx={{ color: 'grey.400', fontSize: 13.5, mt: 1.5, minHeight: 36 }}>{p.description}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mt: 1.5 }}>{(p.features || []).map((f) => <Chip key={f} size="small" label={f} sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#ddd' }} />)}</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Switch size="small" checked={Boolean(p.active)} onChange={() => toggle(p)} data-testid={`plan-toggle-${p.id}`} sx={{ '& .Mui-checked': { color: '#e50914' }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: '#e50914 !important' } }} /><Typography sx={{ color: 'grey.400', fontSize: 13 }}>{p.active ? 'Attivo' : 'Disattivo'}</Typography></Box>
              <Box><IconButton size="small" onClick={() => setForm({ ...p, featuresText: (p.features || []).join('\n') })} data-testid={`plan-edit-${p.id}`} sx={{ color: 'grey.300' }}><EditIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={() => remove(p)} data-testid={`plan-delete-${p.id}`} sx={{ color: '#ff5a63' }}><DeleteOutlineIcon fontSize="small" /></IconButton></Box>
            </Box>
          </Box>
        ))}
      </Box>

      <Dialog open={Boolean(form)} onClose={() => setForm(null)} PaperProps={dialogPaper} data-testid="plan-dialog">
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>{form?.id ? 'Modifica piano' : 'Nuovo piano'}</DialogTitle>
        {form && (
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
            <TextField label="Nome" value={form.name} onChange={set('name')} inputProps={{ 'data-testid': 'plan-name-input' }} sx={fieldSx} />
            <TextField label="Descrizione" value={form.description} onChange={set('description')} multiline minRows={2} inputProps={{ 'data-testid': 'plan-description-input' }} sx={fieldSx} />
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField label="Prezzo (centesimi)" type="number" value={form.price_cents} onChange={set('price_cents')} helperText={euro(Number(form.price_cents) || 0)} inputProps={{ 'data-testid': 'plan-price-input', min: 50 }} sx={fieldSx} fullWidth />
              <TextField label="Badge" value={form.badge} onChange={set('badge')} inputProps={{ 'data-testid': 'plan-badge-input' }} sx={fieldSx} fullWidth />
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField select label="Tipo" value={form.interval} onChange={(e) => { const iv = INTERVALS.find((i) => i[0] === e.target.value); setForm({ ...form, interval: e.target.value, duration_days: iv?.[2] ?? form.duration_days }); }} inputProps={{ 'data-testid': 'plan-interval-select' }} sx={fieldSx} fullWidth>
                {INTERVALS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
              </TextField>
              <TextField label="Durata (giorni)" type="number" value={form.duration_days ?? ''} disabled={form.interval === 'lifetime'} onChange={set('duration_days')} inputProps={{ 'data-testid': 'plan-duration-input' }} sx={fieldSx} fullWidth />
            </Box>
            <TextField label="Caratteristiche (una per riga)" value={form.featuresText} onChange={set('featuresText')} multiline minRows={3} inputProps={{ 'data-testid': 'plan-features-input' }} sx={fieldSx} />
            <TextField label="Ordine" type="number" value={form.order} onChange={set('order')} inputProps={{ 'data-testid': 'plan-order-input' }} sx={fieldSx} />
          </DialogContent>
        )}
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setForm(null)} sx={{ color: 'grey.400', textTransform: 'none' }}>Annulla</Button>
          <Button variant="contained" disabled={busy || !form?.name?.trim()} onClick={save} data-testid="plan-save" sx={redBtn}>Salva</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={Boolean(snack)} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snack && <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} data-testid="plans-snackbar">{snack.message}</Alert>}
      </Snackbar>
    </Box>
  );
};

export default PlansPage;
