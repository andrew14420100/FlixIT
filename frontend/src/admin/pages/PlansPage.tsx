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

const MONTHLY_META_PREFIX = '__monthly_price_cents=';

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
  month: { key: 'month', label: 'Mensile', days: 30, interval: 'month', months: 1 },
  quarter: { key: 'quarter', label: '3 mesi', days: 90, interval: 'custom', months: 3 },
  half: { key: 'half', label: '6 mesi', days: 180, interval: 'custom', months: 6 },
  year: { key: 'year', label: 'Annuale', days: 365, interval: 'year', months: 12 },
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
const visibleFeatures = (features = []) => (features || []).filter((f) => !String(f || '').startsWith('__'));

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

function durationForPlan(plan) {
  return DURATIONS[inferDuration(plan)] || DURATIONS.month;
}

function monthlyMeta(plan) {
  const raw = (plan?.features || []).find((f) => String(f || '').startsWith(MONTHLY_META_PREFIX));
  if (!raw) return null;
  const value = Number(String(raw).slice(MONTHLY_META_PREFIX.length));
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function isConfiguratorPlan(plan) {
  return /^(Base|Pro|Unlimited)\s*·\s*/i.test(String(plan?.name || '').trim());
}

function monthlyPriceForPlan(plan) {
  const meta = monthlyMeta(plan);
  if (meta !== null) return meta;
  const duration = durationForPlan(plan);
  const stored = Math.max(0, Number(plan?.price_cents || 0));
  // Plans created with the previous configurator stored the monthly rate directly.
  if (isConfiguratorPlan(plan)) return stored;
  // Older non-configurator plans historically stored a total price.
  return duration.months > 1 ? Math.round(stored / duration.months) : stored;
}

function totalPriceFromMonthly(monthlyCents, durationKey) {
  const duration = DURATIONS[durationKey] || DURATIONS.month;
  return Math.round(Math.max(0, Number(monthlyCents || 0)) * duration.months);
}

function inferFeatureSelections(plan, planType) {
  const defaults = PLAN_TYPES[planType]?.defaults || PLAN_TYPES.base.defaults;
  const text = normalize(visibleFeatures(plan?.features).join(' | '));
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

function buildForm(planType = 'pro', durationKey = 'month', monthlyPriceCents = 999, active = true, id = null, source = null) {
  const type = PLAN_TYPES[planType] || PLAN_TYPES.pro;
  const selections = source ? inferFeatureSelections(source, type.key) : { ...type.defaults };
  return {
    ...(id ? { id } : {}),
    planType: type.key,
    durationKey,
    monthly_price_cents: Number(monthlyPriceCents) || 0,
    active: Boolean(active),
    ...selections,
  };
}

function payloadFromForm(form) {
  const type = PLAN_TYPES[form.planType] || PLAN_TYPES.base;
  const duration = DURATIONS[form.durationKey] || DURATIONS.month;
  const monthlyCents = Math.max(0, Math.round(Number(form.monthly_price_cents) || 0));
  const totalCents = totalPriceFromMonthly(monthlyCents, form.durationKey);
  return {
    name: `${type.label} · ${duration.label}`,
    description: type.description,
    price_cents: totalCents,
    currency: 'EUR',
    interval: duration.interval,
    duration_days: duration.days,
    badge: type.badge,
    features: [...featureStrings(form), `${MONTHLY_META_PREFIX}${monthlyCents}`],
    active: Boolean(form.active),
    order: type.order,
  };
}

function existingPlanPayload(plan, overrides = {}) {
  return {
    name: plan.name || '',
    description: plan.description || '',
    price_cents: Number(plan.price_cents) || 0,
    currency: plan.currency || 'EUR',
    interval: plan.interval || 'month',
    duration_days: plan.duration_days ?? null,
    badge: plan.badge || '',
    features: Array.isArray(plan.features) ? plan.features : [],
    active: Boolean(plan.active),
    order: Number(plan.order) || 0,
    ...overrides,
  };
}

const PlansPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [snack, setSnack] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const first = await api('/api/admin/plans');
      let loaded = first.items || [];

      // One-time migration for Base/Pro/Unlimited plans created by the previous
      // configurator: their stored price was monthly. Convert it to the real
      // one-off checkout total while preserving the monthly rate as metadata.
      const legacy = loaded.filter((plan) => {
        const duration = durationForPlan(plan);
        return isConfiguratorPlan(plan) && duration.months > 1 && monthlyMeta(plan) === null;
      });

      if (legacy.length) {
        await Promise.all(legacy.map((plan) => {
          const duration = durationForPlan(plan);
          const monthlyCents = Math.max(0, Math.round(Number(plan.price_cents) || 0));
          const totalCents = monthlyCents * duration.months;
          const features = [...visibleFeatures(plan.features), `${MONTHLY_META_PREFIX}${monthlyCents}`];
          return api(`/api/admin/plans/${plan.id}`, {
            method: 'PUT',
            body: JSON.stringify(existingPlanPayload(plan, { price_cents: totalCents, features })),
          });
        }));
        const refreshed = await api('/api/admin/plans');
        loaded = refreshed.items || [];
      }

      setItems(loaded);
    } catch (e: any) {
      setSnack({ severity: 'error', message: e?.message || 'Impossibile caricare i piani' });
    }
  };

  useEffect(() => { load(); }, []);

  const preset = useMemo(() => form ? PLAN_TYPES[form.planType] || PLAN_TYPES.base : PLAN_TYPES.base, [form?.planType]);
  const duration = useMemo(() => form ? DURATIONS[form.durationKey] || DURATIONS.month : DURATIONS.month, [form?.durationKey]);
  const duplicate = form ? items.find((item) => (!form.id || item.id !== form.id) && inferPlanType(item) === form.planType && inferDuration(item) === form.durationKey) : null;

  const openNew = () => setForm(buildForm('pro', 'month', 999, true));
  const openEdit = (plan) => {
    const planType = inferPlanType(plan);
    setForm(buildForm(planType, inferDuration(plan), monthlyPriceForPlan(plan), plan.active, plan.id, plan));
  };
  const changePlanType = (nextType) => setForm({ ...form, planType: nextType, ...(PLAN_TYPES[nextType]?.defaults || PLAN_TYPES.base.defaults) });

  const save = async () => {
    if (!form) return;
    if (duplicate) {
      setSnack({ severity: 'warning', message: `Esiste già ${preset.label} · ${duration.label}.` });
      return;
    }
    setBusy(true);
    try {
      const body = payloadFromForm(form);
      await api(form.id ? `/api/admin/plans/${form.id}` : '/api/admin/plans', {
        method: form.id ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      setSnack({ severity: 'success', message: `${preset.label} · ${duration.label} salvato` });
      setForm(null);
      await load();
    } catch (e: any) {
      setSnack({ severity: 'error', message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Eliminare il piano ${p.name}?`)) return;
    try {
      await api(`/api/admin/plans/${p.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setSnack({ severity: 'error', message: e.message });
    }
  };

  const toggle = async (p) => {
    try {
      await api(`/api/admin/plans/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify(existingPlanPayload(p, { active: !p.active })),
      });
      await load();
    } catch (e: any) {
      setSnack({ severity: 'error', message: e.message });
    }
  };

  return (
    <Box data-testid="admin-plans-page">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>Piani Premium</Typography>
          <Typography sx={{ color: 'grey.500', fontSize: 13.5 }}>
            Il prezzo che inserisci è sempre mensile. FlixIT calcola automaticamente il totale da addebitare in base alla durata.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openNew} data-testid="plan-add-button" sx={redBtn}>Nuovo abbonamento</Button>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' } }}>
        {items.map((p) => {
          const pDuration = durationForPlan(p);
          const monthlyCents = monthlyPriceForPlan(p);
          const totalCents = Number(p.price_cents) || 0;
          return (
            <Box key={p.id} sx={{ ...cardSx, p: 2.5, opacity: p.active ? 1 : 0.55 }} data-testid={`plan-row-${p.id}`}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                <Box>
                  <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>
                    {p.name} {p.badge && <Chip size="small" label={p.badge} sx={{ ml: 1, bgcolor: 'rgba(229,9,20,0.2)', color: '#ff5a63', fontWeight: 600 }} />}
                  </Typography>
                  <Typography sx={{ color: 'grey.500', fontSize: 13 }}>{pDuration.label}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography data-testid={`plan-row-price-${p.id}`} sx={{ color: '#fff', fontWeight: 800, fontSize: 22 }}>{euro(monthlyCents, p.currency)}</Typography>
                  <Typography sx={{ color: 'rgba(255,255,255,.42)', fontSize: 11.5 }}>/ mese</Typography>
                </Box>
              </Box>

              {pDuration.months > 1 && (
                <Box sx={{ mt: 1.4, px: 1.3, py: 1, borderRadius: '10px', bgcolor: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.07)' }}>
                  <Typography sx={{ color: 'rgba(255,255,255,.52)', fontSize: 12.5 }}>
                    Totale addebitato per {pDuration.label.toLowerCase()}: <strong style={{ color: '#fff' }}>{euro(totalCents, p.currency)}</strong>
                  </Typography>
                </Box>
              )}

              <Typography sx={{ color: 'grey.400', fontSize: 13.5, mt: 1.5, minHeight: 36 }}>{p.description}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mt: 1.5 }}>
                {visibleFeatures(p.features).map((f) => <Chip key={f} size="small" label={f} sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#ddd' }} />)}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Switch size="small" checked={Boolean(p.active)} onChange={() => toggle(p)} data-testid={`plan-toggle-${p.id}`} />
                  <Typography sx={{ color: 'grey.400', fontSize: 13 }}>{p.active ? 'Attivo' : 'Disattivo'}</Typography>
                </Box>
                <Box>
                  <IconButton size="small" onClick={() => openEdit(p)} data-testid={`plan-edit-${p.id}`} sx={{ color: 'grey.300' }}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" onClick={() => remove(p)} data-testid={`plan-delete-${p.id}`} sx={{ color: '#ff5a63' }}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Dialog open={Boolean(form)} onClose={() => setForm(null)} PaperProps={{ ...dialogPaper, sx: { ...(dialogPaper?.sx || {}), maxWidth: 780, width: 'calc(100% - 32px)' } }} data-testid="plan-dialog">
        <DialogTitle sx={{ color: '#fff', fontWeight: 800, pb: 1 }}>{form?.id ? 'Modifica abbonamento' : 'Nuovo abbonamento'}</DialogTitle>
        {form && (
          <DialogContent sx={{ pt: '10px !important' }}>
            <Typography sx={{ color: 'rgba(255,255,255,.5)', fontSize: 13, mb: 2.5 }}>
              Inserisci il prezzo mensile. Il totale del periodo viene calcolato automaticamente e sarà quello addebitato al checkout.
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField select label="Piano" value={form.planType} onChange={(e) => changePlanType(e.target.value)} inputProps={{ 'data-testid': 'plan-type-select' }} sx={fieldSx} fullWidth>
                {Object.values(PLAN_TYPES).map((item: any) => <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>)}
              </TextField>
              <TextField select label="Durata" value={form.durationKey} onChange={(e) => setForm({ ...form, durationKey: e.target.value })} inputProps={{ 'data-testid': 'plan-duration-select' }} sx={fieldSx} fullWidth>
                {Object.values(DURATIONS).map((item: any) => <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>)}
              </TextField>
            </Box>

            <Box sx={{ mt: 2 }}>
              <TextField
                label="Prezzo al mese (€)"
                type="number"
                value={(Number(form.monthly_price_cents) || 0) / 100}
                onChange={(e) => setForm({ ...form, monthly_price_cents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })}
                helperText={duration.months > 1
                  ? `${euro(Number(form.monthly_price_cents) || 0, 'EUR')}/mese × ${duration.months} = ${euro(totalPriceFromMonthly(form.monthly_price_cents, form.durationKey), 'EUR')} totale`
                  : `${euro(Number(form.monthly_price_cents) || 0, 'EUR')} al mese`}
                inputProps={{ 'data-testid': 'plan-price-input', min: 0.5, step: '0.01' }}
                sx={fieldSx}
                fullWidth
              />
            </Box>

            <Box sx={{ mt: 2, p: 1.6, borderRadius: '12px', bgcolor: 'rgba(229,9,20,.07)', border: '1px solid rgba(229,9,20,.16)' }}>
              <Typography sx={{ color: 'rgba(255,255,255,.62)', fontSize: 12.5 }}>
                Il cliente vedrà <strong style={{ color: '#fff' }}>{euro(Number(form.monthly_price_cents) || 0)}/mese</strong>
                {duration.months > 1 ? <> e pagherà una sola volta <strong style={{ color: '#fff' }}>{euro(totalPriceFromMonthly(form.monthly_price_cents, form.durationKey))}</strong> per {duration.label.toLowerCase()}.</> : '.'}
              </Typography>
            </Box>

            <Typography sx={{ color: '#fff', fontSize: 13.5, fontWeight: 750, mt: 3, mb: 1.5 }}>Funzionalità incluse</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField select label="Qualità video" value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })} inputProps={{ 'data-testid': 'plan-quality-select' }} sx={fieldSx} fullWidth>
                {QUALITY_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
              </TextField>
              <TextField select label="Dispositivi" value={form.devices} onChange={(e) => setForm({ ...form, devices: e.target.value })} inputProps={{ 'data-testid': 'plan-devices-select' }} sx={fieldSx} fullWidth>
                {DEVICE_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
              </TextField>
              <TextField select label="Pubblicità" value={form.ads} onChange={(e) => setForm({ ...form, ads: e.target.value })} inputProps={{ 'data-testid': 'plan-ads-select' }} sx={fieldSx} fullWidth>
                {ADS_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
              </TextField>
              <TextField select label="Priorità" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} inputProps={{ 'data-testid': 'plan-priority-select' }} sx={fieldSx} fullWidth>
                {PRIORITY_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
              </TextField>
            </Box>

            <Divider sx={{ my: 2.6, borderColor: 'rgba(255,255,255,.08)' }} />

            <Box sx={{ ...cardSx, p: 2, bgcolor: 'rgba(255,255,255,.025)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <CheckRoundedIcon sx={{ color: '#8ee6a9', fontSize: 19 }} />
                <Typography sx={{ color: '#fff', fontWeight: 750, fontSize: 14 }}>Anteprima funzionalità</Typography>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.1 }}>
                <Preview icon={<CalendarMonthRoundedIcon />} label="Durata" value={duration.label} />
                <Preview icon={<HdRoundedIcon />} label="Qualità" value={optionLabel(QUALITY_OPTIONS, form.quality)} />
                <Preview icon={<DevicesRoundedIcon />} label="Dispositivi" value={optionLabel(DEVICE_OPTIONS, form.devices)} />
                <Preview icon={form.ads === 'none' ? <BlockRoundedIcon /> : <PlayCircleOutlineRoundedIcon />} label="Pubblicità" value={optionLabel(ADS_OPTIONS, form.ads)} />
                <Preview icon={<BoltRoundedIcon />} label="Priorità" value={optionLabel(PRIORITY_OPTIONS, form.priority)} />
                <Preview icon={<CheckRoundedIcon />} label="Catalogo" value="Film e Serie TV" />
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2.6, px: .5 }}>
              <Box>
                <Typography sx={{ color: '#fff', fontSize: 13.5, fontWeight: 700 }}>Abbonamento attivo</Typography>
                <Typography sx={{ color: 'rgba(255,255,255,.42)', fontSize: 12 }}>Se disattivato non compare nella pagina Premium.</Typography>
              </Box>
              <Switch checked={Boolean(form.active)} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            </Box>

            {duplicate && <Alert severity="warning" sx={{ mt: 2 }}>Esiste già {preset.label} · {duration.label}. Modifica quello esistente oppure scegli un'altra combinazione.</Alert>}
          </DialogContent>
        )}
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
          <Button onClick={() => setForm(null)} sx={{ color: 'grey.400', textTransform: 'none' }}>Annulla</Button>
          <Button variant="contained" disabled={busy || Boolean(duplicate) || Number(form?.monthly_price_cents || 0) < 50} onClick={save} data-testid="plan-save" sx={redBtn}>
            {busy ? 'Salvataggio…' : 'Salva abbonamento'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(snack)} autoHideDuration={4200} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snack && <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} data-testid="plans-snackbar">{snack.message}</Alert>}
      </Snackbar>
    </Box>
  );
};

function Preview({ icon, label, value }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.2, py: 1, borderRadius: '10px', bgcolor: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.055)' }}>
      <Box sx={{ color: 'rgba(255,255,255,.55)', display: 'grid', placeItems: 'center', '& svg': { fontSize: 18 } }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ color: 'rgba(255,255,255,.38)', fontSize: 10.5, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em' }}>{label}</Typography>
        <Typography noWrap sx={{ color: '#fff', fontSize: 12.5, fontWeight: 650 }}>{value}</Typography>
      </Box>
    </Box>
  );
}

export default PlansPage;
