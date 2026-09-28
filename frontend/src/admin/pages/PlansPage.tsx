// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
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
import Divider from '@mui/material/Divider';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import HdRoundedIcon from '@mui/icons-material/HdRounded';
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import { api, cardSx, dialogPaper, fieldSx, redBtn, euro } from './shared';

const PLAN_TYPES = {
  base: {
    key: 'base', label: 'Base', description: "L'essenziale per guardare tutto il catalogo FlixIT.", badge: '', order: 10,
    defaults: { quality: '720p', devices: '1', ads: 'one', priority: '3' },
  },
  pro: {
    key: 'pro', label: 'Pro', description: 'Più qualità e meno limiti per una visione più completa.', badge: 'Più scelto', order: 20,
    defaults: { quality: '1080p', devices: '2', ads: 'none', priority: '2' },
  },
  unlimited: {
    key: 'unlimited', label: 'Unlimited', description: 'La massima libertà di visione su tutti i tuoi dispositivi.', badge: '', order: 30,
    defaults: { quality: '1080p', devices: 'unlimited', ads: 'none', priority: '1' },
  },
};

const DURATIONS = {
  month: { key: 'month', label: 'Mensile', days: 30, interval: 'month' },
  quarter: { key: 'quarter', label: '3 mesi', days: 90, interval: 'custom' },
  half: { key: 'half', label: '6 mesi', days: 180, interval: 'custom' },
  year: { key: 'year', label: 'Annuale', days: 365, interval: 'year' },
};

const QUALITY_OPTIONS = [
  { value: '720p', label: 'Fino a 720p' },
  { value: '1080p', label: 'Fino a 1080p' },
];
const DEVICE_OPTIONS = [
  { value: '1', label: '1 dispositivo' },
  { value: '2', label: '2 dispositivi' },
  { value: 'unlimited', label: 'Dispositivi illimitati' },
];
const ADS_OPTIONS = [
  { value: 'one', label: '1 pubblicità a contenuto' },
  { value: 'none', label: 'Senza pubblicità' },
];
const PRIORITY_OPTIONS = [
  { value: '1', label: 'Livello 1' },
  { value: '2', label: 'Livello 2' },
  { value: '3', label: 'Livello 3' },
];

const optionLabel = (options, value) => options.find((item) => item.value === value)?.label || '';
const normalize = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();

function inferPlanType(plan) {
  const name = normalize(plan?.name);
  if (name.includes('unlimited') || name.includes('illimitato')) return 'unlimited';
  if (name.includes('pro') || name.includes('standard')) return 'pro';
  return 'base';
}

function inferDuration(plan) {
  const days = Number(plan?.duration_days || 0);
  if (days === 365 || plan?.interval === 'year') return 'year';
  if (days === 180) return 'half';
  if (days === 90) return 'quarter';
  return 'month';
}

function inferFeatureSelections(plan, planType) {
  const defaults = PLAN_TYPES[planType]?.defaults || PLAN_TYPES.base.defaults;
  const text = normalize((plan?.features || []).join(' | '));
  return {
    quality: text.includes('1080p') ? '1080p' : text.includes('720p') ? '720p' : defaults.quality,
    devices: text.includes('illimitat') ? 'unlimited' : /\b2 dispositiv/.test(text) ? '2' : /\b1 dispositiv/.test(text) ? '1' : defaults.devices,
    ads: text.includes('senza pubblicita') ? 'none' : text.includes('1 pubblicita') ? 'one' : defaults.ads,
    priority: text.includes('livello 1') ? '1' : text.includes('livello 2') ? '2' : text.includes('livello 3') ? '3' : defaults.priority,
  };
}

function featureStrings(form) {
  return [
    'Tutto il catalogo Film e Serie TV',
    optionLabel(QUALITY_OPTIONS, form.quality),
    optionLabel(DEVICE_OPTIONS, form.devices),
    optionLabel(ADS_OPTIONS, form.ads),
    `Priorità ${optionLabel(PRIORITY_OPTIONS, form.priority).toLowerCase()}`,
  ].filter(Boolean);
}

function buildForm(planType = 'pro', durationKey = 'month', priceCents = 999, active = true, id = null, source = null) {
  const type = PLAN_TYPES[planType] || PLAN_TYPES.pro;
  const selections = source ? inferFeatureSelections(source, type.key) : { ...type.defaults };
  return { ...(id ? { id } : {}), planType: type.key, durationKey, price_cents: Number(priceCents) || 0, active: Boolean(active), ...selections };
}

function payloadFromForm(form) {
  const type = PLAN_TYPES[form.planType] || PLAN_TYPES.base;
  const duration = DURATIONS[form.durationKey] || DURATIONS.month;
  return {
    name: `${type.label} · ${duration.label}`,
    description: type.description,
    price_cents: Number(form.price_cents) || 0,
    currency: 'EUR',
    interval: duration.interval,
    duration_days: duration.days,
    badge: type.badge,
    features: featureStrings(form),
    active: Boolean(form.active),
    order: type.order,
  };
}

const PlansPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [snack, setSnack] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api('/api/admin/plans').then((d) => setItems(d.items || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const preset = useMemo(() => form ? PLAN_TYPES[form.planType] || PLAN_TYPES.base : PLAN_TYPES.base, [form?.planType]);
  const duration = useMemo(() => form ? DURATIONS[form.durationKey] || DURATIONS.month : DURATIONS.month, [form?.durationKey]);
  const duplicate = form ? items.find((item) => (!form.id || item.id !== form.id) && inferPlanType(item) === form.planType && inferDuration(item) === form.durationKey) : null;

  const openNew = () => setForm(buildForm('pro', 'month', 999, true));
  const openEdit = (plan) => {
    const planType = inferPlanType(plan);
    setForm(buildForm(planType, inferDuration(plan), plan.price_cents, plan.active, plan.id, plan));
  };
  const changePlanType = (nextType) => setForm({ ...form, planType: nextType, ...(PLAN_TYPES[nextType]?.defaults || PLAN_TYPES.base.defaults) });

  const save = async () => {
    if (!form) return;
    if (duplicate) { setSnack({ severity: 'warning', message: `Esiste già ${preset.label} · ${duration.label}.` }); return; }
    setBusy(true);
    try {
      const body = payloadFromForm(form);
      await api(form.id ? `/api/admin/plans/${form.id}` : '/api/admin/plans', { method: form.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setSnack({ severity: 'success', message: `${preset.label} · ${duration.label} salvato` });
      setForm(null); load();
    } catch (e: any) { setSnack({ severity: 'error', message: e.message }); }
    finally { setBusy(false); }
  };

  const remove = async (p) => { if (!window.confirm(`Eliminare il piano ${p.name}?`)) return; try { await api(`/api/admin/plans/${p.id}`, { method: 'DELETE' }); load(); } catch (e: any) { setSnack({ severity: 'error', message: e.message }); } };
  const toggle = async (p) => { try { await api(`/api/admin/plans/${p.id}`, { method: 'PUT', body: JSON.stringify({ ...p, active: !p.active }) }); load(); } catch (e: any) { setSnack({ severity: 'error', message: e.message }); } };

  return (
    <Box data-testid="admin-plans-page">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>Piani Premium</Typography>
          <Typography sx={{ color: 'grey.500', fontSize: 13.5 }}>Scegli piano, durata, prezzo e funzionalità da opzioni già pronte. Nessuna caratteristica va scritta a mano.</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openNew} data-testid="plan-add-button" sx={redBtn}>Nuovo abbonamento</Button>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' } }}>
        {items.map((p) => (
          <Box key={p.id} sx={{ ...cardSx, p: 2.5, opacity: p.active ? 1 : 0.55 }} data-testid={`plan-row-${p.id}`}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
              <Box>
                <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>{p.name} {p.badge && <Chip size="small" label={p.badge} sx={{ ml: 1, bgcolor: 'rgba(229,9,20,0.2)', color: '#ff5a63', fontWeight: 600 }} />}</Typography>
                <Typography sx={{ color: 'grey.500', fontSize: 13 }}>{DURATIONS[inferDuration(p)]?.label || `${p.duration_days} giorni`}</Typography>
              </Box>
              <Typography data-testid={`plan-row-price-${p.id}`} sx={{ color: '#fff', fontWeight: 800, fontSize: 22 }}>{euro(p.price_cents, p.currency)}</Typography>
            </Box>
            <Typography sx={{ color: 'grey.400', fontSize: 13.5, mt: 1.5, minHeight: 36 }}>{p.description}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mt: 1.5 }}>{(p.features || []).map((f) => <Chip key={f} size="small" label={f} sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#ddd' }} />)}</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Switch size="small" checked={Boolean(p.active)} onChange={() => toggle(p)} data-testid={`plan-toggle-${p.id}`} /><Typography sx={{ color: 'grey.400', fontSize: 13 }}>{p.active ? 'Attivo' : 'Disattivo'}</Typography></Box>
              <Box><IconButton size="small" onClick={() => openEdit(p)} data-testid={`plan-edit-${p.id}`} sx={{ color: 'grey.300' }}><EditIcon fontSize="small" /></IconButton><IconButton size="small" onClick={() => remove(p)} data-testid={`plan-delete-${p.id}`} sx={{ color: '#ff5a63' }}><DeleteOutlineIcon fontSize="small" /></IconButton></Box>
            </Box>
          </Box>
        ))}
      </Box>

      <Dialog open={Boolean(form)} onClose={() => setForm(null)} PaperProps={{ ...dialogPaper, sx: { ...(dialogPaper?.sx || {}), maxWidth: 780, width: 'calc(100% - 32px)' } }} data-testid="plan-dialog">
        <DialogTitle sx={{ color: '#fff', fontWeight: 800, pb: 1 }}>{form?.id ? 'Modifica abbonamento' : 'Nuovo abbonamento'}</DialogTitle>
        {form && (
          <DialogContent sx={{ pt: '10px !important' }}>
            <Typography sx={{ color: 'rgba(255,255,255,.5)', fontSize: 13, mb: 2.5 }}>Scegli le opzioni: FlixIT genera automaticamente nome, durata e lista delle funzionalità.</Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField select label="Piano" value={form.planType} onChange={(e) => changePlanType(e.target.value)} inputProps={{ 'data-testid': 'plan-type-select' }} sx={fieldSx} fullWidth>{Object.values(PLAN_TYPES).map((item: any) => <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>)}</TextField>
              <TextField select label="Durata" value={form.durationKey} onChange={(e) => setForm({ ...form, durationKey: e.target.value })} inputProps={{ 'data-testid': 'plan-duration-select' }} sx={fieldSx} fullWidth>{Object.values(DURATIONS).map((item: any) => <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>)}</TextField>
            </Box>

            <Box sx={{ mt: 2 }}><TextField label="Prezzo (€)" type="number" value={(Number(form.price_cents) || 0) / 100} onChange={(e) => setForm({ ...form, price_cents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })} helperText={`Totale mostrato agli utenti: ${euro(Number(form.price_cents) || 0, 'EUR')}`} inputProps={{ 'data-testid': 'plan-price-input', min: 0, step: '0.01' }} sx={fieldSx} fullWidth /></Box>

            <Typography sx={{ color: '#fff', fontSize: 13.5, fontWeight: 750, mt: 3, mb: 1.5 }}>Funzionalità incluse</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField select label="Qualità video" value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })} inputProps={{ 'data-testid': 'plan-quality-select' }} sx={fieldSx} fullWidth>{QUALITY_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}</TextField>
              <TextField select label="Dispositivi" value={form.devices} onChange={(e) => setForm({ ...form, devices: e.target.value })} inputProps={{ 'data-testid': 'plan-devices-select' }} sx={fieldSx} fullWidth>{DEVICE_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}</TextField>
              <TextField select label="Pubblicità" value={form.ads} onChange={(e) => setForm({ ...form, ads: e.target.value })} inputProps={{ 'data-testid': 'plan-ads-select' }} sx={fieldSx} fullWidth>{ADS_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}</TextField>
              <TextField select label="Priorità" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} inputProps={{ 'data-testid': 'plan-priority-select' }} sx={fieldSx} fullWidth>{PRIORITY_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}</TextField>
            </Box>

            <Box sx={{ mt: 2.5, p: 2.2, borderRadius: '14px', bgcolor: 'rgba(255,255,255,.025)', border: '1px solid rgba(150,182,212,.14)' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1.4 }}><Box><Typography sx={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>{preset.label} · {duration.label}</Typography><Typography sx={{ color: 'rgba(255,255,255,.48)', fontSize: 12.5, mt: .3 }}>{preset.description}</Typography></Box>{preset.badge ? <Chip size="small" label={preset.badge} sx={{ bgcolor: 'rgba(229,9,20,.14)', color: '#ff757c' }} /> : null}</Box>
              <Divider sx={{ borderColor: 'rgba(255,255,255,.08)', mb: 1 }} />
              {[[CheckRoundedIcon, 'Catalogo', 'Film e Serie TV'], [HdRoundedIcon, 'Qualità', optionLabel(QUALITY_OPTIONS, form.quality)], [DevicesRoundedIcon, 'Dispositivi', optionLabel(DEVICE_OPTIONS, form.devices)], [form.ads === 'none' ? BlockRoundedIcon : PlayCircleOutlineRoundedIcon, 'Pubblicità', optionLabel(ADS_OPTIONS, form.ads)], [BoltRoundedIcon, 'Priorità', optionLabel(PRIORITY_OPTIONS, form.priority)], [CalendarMonthRoundedIcon, 'Durata', `${duration.label} · ${duration.days} giorni`]].map(([Icon, label, value]: any) => <Box key={label} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: .8 }}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Icon sx={{ fontSize: 18, color: 'rgba(255,255,255,.52)' }} /><Typography sx={{ color: 'rgba(255,255,255,.48)', fontSize: 12.5 }}>{label}</Typography></Box><Typography sx={{ color: '#fff', fontSize: 13, fontWeight: 650, textAlign: 'right' }}>{value}</Typography></Box>)}
            </Box>

            {duplicate ? <Alert severity="warning" sx={{ mt: 2 }}>Esiste già un abbonamento <strong>{preset.label} · {duration.label}</strong>.</Alert> : null}

            <Box sx={{ mt: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, p: 1.6, borderRadius: '12px', bgcolor: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)' }}><Box><Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 13.5 }}>Abbonamento attivo</Typography><Typography sx={{ color: 'rgba(255,255,255,.42)', fontSize: 12, mt: .25 }}>Se disattivato non viene mostrato nella pagina Premium.</Typography></Box><Switch checked={Boolean(form.active)} onChange={(e) => setForm({ ...form, active: e.target.checked })} /></Box>
          </DialogContent>
        )}
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}><Button onClick={() => setForm(null)} sx={{ color: 'grey.400', textTransform: 'none' }}>Annulla</Button><Button variant="contained" disabled={busy || Boolean(duplicate) || Number(form?.price_cents) <= 0} onClick={save} data-testid="plan-save" sx={redBtn}>{form?.id ? 'Salva modifiche' : 'Crea abbonamento'}</Button></DialogActions>
      </Dialog>

      <Snackbar open={Boolean(snack)} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>{snack && <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} data-testid="plans-snackbar">{snack.message}</Alert>}</Snackbar>
    </Box>
  );
};

export default PlansPage;
