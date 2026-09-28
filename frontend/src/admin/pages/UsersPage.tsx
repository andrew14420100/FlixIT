// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Avatar from '@mui/material/Avatar';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Divider from '@mui/material/Divider';
import BlockIcon from '@mui/icons-material/Block';
import LockResetIcon from '@mui/icons-material/LockReset';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import { useAuth } from '../context/AuthContext';
import { avatarSrc } from 'src/config/avatars';
import { RefundDialog, PaymentsTable } from './PaymentsPage';
import { api, cardSx, dialogPaper, fieldSx, redBtn, tableSx, fmt, fmtDay } from './shared';

const ROLE_LABEL = { user: 'Utente', admin: 'Admin', superadmin: 'Superadmin' };
const ROLE_COLOR = { user: 'rgba(255,255,255,0.08)', admin: 'rgba(251,191,36,0.2)', superadmin: 'rgba(229,9,20,0.25)' };

function Stat({ label, value, color = '#fff', testId }) {
  return (<Box sx={{ ...cardSx, p: 2, flex: '1 1 140px' }} data-testid={testId}><Typography sx={{ color: 'grey.500', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</Typography><Typography sx={{ color, fontSize: 26, fontWeight: 800, mt: 0.3, lineHeight: 1 }}>{value ?? '—'}</Typography></Box>);
}

function LockedHint({ allowed, children }) {
  if (allowed) return children;
  return <Tooltip title="Solo Superadmin"><span>{React.cloneElement(children, { disabled: true })}</span></Tooltip>;
}

function CreateUserDialog({ open, plans, onClose, onDone }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName(''); setEmail(''); setPlanId(''); setError(null);
  }, [open]);

  const submit = async () => {
    if (!name.trim() || !email.trim()) return setError('Inserisci nome utente ed email.');
    setBusy(true); setError(null);
    try {
      const data = await api('/api/admin/users/manual-create', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), plan_id: planId || null }),
      });
      onDone(data?.user);
    } catch (e: any) {
      setError(e?.message || 'Creazione utente fallita');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} PaperProps={{ ...dialogPaper, sx: { ...(dialogPaper?.sx || {}), width: 'min(560px, calc(100% - 28px))' } }} data-testid="create-user-dialog">
      <DialogTitle sx={{ color: '#fff', fontWeight: 800 }}>Nuovo utente</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '10px !important' }}>
        <Alert severity="info" sx={{ bgcolor: 'rgba(96,165,250,.08)', color: '#bfdbfe' }}>Al primo accesso l'utente inserirà la sua email e dovrà creare la password nel popup obbligatorio.</Alert>
        <TextField label="Nome utente" value={name} onChange={(e) => setName(e.target.value)} sx={fieldSx} fullWidth />
        <TextField type="email" label="Email" value={email} onChange={(e) => setEmail(e.target.value)} sx={fieldSx} fullWidth />
        <TextField select label="Piano" value={planId} onChange={(e) => setPlanId(e.target.value)} sx={fieldSx} fullWidth>
          <MenuItem value="">Gratuito</MenuItem>
          {plans.map((p) => <MenuItem key={p.id} value={p.id}>{p.name} · {p.duration_days ? `${p.duration_days} gg` : 'a vita'}</MenuItem>)}
        </TextField>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button disabled={busy} onClick={onClose} sx={{ color: 'grey.400', textTransform: 'none' }}>Annulla</Button>
        <Button disabled={busy || !name.trim() || !email.trim()} onClick={submit} variant="contained" sx={redBtn}>{busy ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Crea utente'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function PremiumDialog({ user, plans, onClose, onDone }) {
  const [mode, setMode] = useState('plan');
  const [planId, setPlanId] = useState(plans[0]?.id || '');
  const [days, setDays] = useState(30);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (revoke = false) => {
    setBusy(true); setError(null);
    try {
      if (revoke) await api(`/api/admin/users/${user.id}/premium`, { method: 'DELETE' });
      else await api(`/api/admin/users/${user.id}/premium`, { method: 'POST', body: JSON.stringify(mode === 'plan' ? { plan_id: planId } : mode === 'days' ? { duration_days: Number(days) } : mode === 'date' ? { expires_at: new Date(`${date}T23:59:59`).toISOString() } : { lifetime: true }) });
      onDone(revoke ? 'Premium revocato' : 'Premium aggiornato');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const MODES = [['plan', 'Da piano'], ['days', 'Giorni'], ['date', 'Scadenza'], ['lifetime', 'A vita']];
  return (
    <Dialog open={Boolean(user)} onClose={onClose} PaperProps={dialogPaper}>
      <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>Premium · {user?.email}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ color: 'grey.400', fontSize: 13.5 }}>Stato attuale: {user?.is_premium ? (user.premium?.lifetime ? 'Premium a vita' : `Premium fino al ${fmtDay(user.premium?.expiresAt)}`) : 'Free'}</Typography>
        <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>{MODES.map(([m, l]) => <Chip key={m} label={l} onClick={() => setMode(m)} sx={{ bgcolor: mode === m ? '#e50914' : 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600 }} />)}</Box>
        {mode === 'plan' && <TextField select label="Piano" value={planId} onChange={(e) => setPlanId(e.target.value)} sx={fieldSx}>{plans.map((p) => <MenuItem key={p.id} value={p.id}>{p.name} · {p.duration_days ? `${p.duration_days} gg` : 'a vita'}</MenuItem>)}</TextField>}
        {mode === 'days' && <TextField type="number" label="Giorni da aggiungere" value={days} onChange={(e) => setDays(e.target.value)} sx={fieldSx} />}
        {mode === 'date' && <TextField type="date" label="Nuova data di scadenza" InputLabelProps={{ shrink: true }} value={date} onChange={(e) => setDate(e.target.value)} sx={fieldSx} />}
        {mode === 'lifetime' && <Alert severity="info" sx={{ bgcolor: 'rgba(96,165,250,0.1)', color: '#bfdbfe' }}>Premium permanente, nessuna scadenza.</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        {user?.is_premium && <Button disabled={busy} onClick={() => submit(true)} sx={{ color: '#ff5a63', textTransform: 'none', mr: 'auto' }}>Revoca</Button>}
        <Button onClick={onClose} sx={{ color: 'grey.400', textTransform: 'none' }}>Chiudi</Button>
        <Button variant="contained" disabled={busy || (mode === 'date' && !date) || (mode === 'plan' && !planId)} onClick={() => submit(false)} sx={redBtn}>{busy ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Applica'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function PaymentsDialog({ user, canRefund, onClose, onRefunded }) {
  const [items, setItems] = useState(null);
  const [refundTx, setRefundTx] = useState(null);
  const load = useCallback(() => { if (user) api(`/api/admin/users/${user.id}/payments`).then((d) => setItems(d.items)).catch(() => setItems([])); }, [user]);
  useEffect(() => { setItems(null); load(); }, [load]);
  return (
    <Dialog open={Boolean(user)} onClose={onClose} maxWidth="lg" PaperProps={{ sx: { ...dialogPaper.sx, minWidth: { md: 900 } } }}>
      <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>Storico pagamenti · {user?.email}</DialogTitle>
      <DialogContent>
        {!canRefund && <Alert severity="info" sx={{ mb: 2, bgcolor: 'rgba(96,165,250,.08)', color: '#bfdbfe' }}>Sola lettura: i rimborsi sono riservati al Superadmin.</Alert>}
        {items === null ? <CircularProgress sx={{ color: '#e50914' }} /> : items.length === 0 ? <Typography sx={{ color: 'grey.500' }}>Nessun pagamento registrato.</Typography> : <Box sx={{ overflowX: 'auto' }}><PaymentsTable items={items} compact onRefund={canRefund ? setRefundTx : undefined} /></Box>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose} sx={{ color: 'grey.400', textTransform: 'none' }}>Chiudi</Button></DialogActions>
      {canRefund && <RefundDialog tx={refundTx} onClose={() => setRefundTx(null)} onDone={() => { setRefundTx(null); load(); onRefunded(); }} />}
    </Dialog>
  );
}

function AdminPermissionsDialog({ target, open, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !target) return;
    setLoading(true); setError('');
    api('/api/admin/admins')
      .then((data) => {
        const row = (data.items || []).find((x) => x.id === target.id);
        setGroups(data.groups || []);
        setPermissions(row?.effective_permissions || data.defaults || {});
      })
      .catch((e) => setError(e.message || 'Impossibile caricare i permessi'))
      .finally(() => setLoading(false));
  }, [open, target]);

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api(`/api/admin/admins/${target.id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) });
      onDone('Permessi Admin aggiornati');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setError('');
    try {
      const data = await api(`/api/admin/admins/${target.id}/permissions/reset`, { method: 'POST' });
      setPermissions(data.permissions || {});
      onDone('Permessi riportati ai limiti predefiniti');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="md" fullWidth PaperProps={dialogPaper}>
      <DialogTitle sx={{ color: '#fff', fontWeight: 800 }}>Permessi Admin · {target?.email}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2, bgcolor: 'rgba(96,165,250,.08)', color: '#bfdbfe' }}>Il Superadmin ha sempre accesso completo. Questi interruttori modificano solo questo Admin.</Alert>
        {loading ? <Box sx={{ py: 5, textAlign: 'center' }}><CircularProgress sx={{ color: '#e50914' }} /></Box> : groups.map((group) => (
          <Box key={group.id} sx={{ mb: 2.2 }}>
            <Typography sx={{ color: '#fff', fontWeight: 750, mb: 1 }}>{group.label}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: .7 }}>
              {(group.items || []).map((item) => <FormControlLabel key={item.key} control={<Switch checked={Boolean(permissions[item.key])} onChange={(e) => setPermissions((p) => ({ ...p, [item.key]: e.target.checked }))} />} label={item.label} sx={{ m: 0, color: 'rgba(255,255,255,.78)', '& .MuiFormControlLabel-label': { fontSize: 13.5 } }} />)}
            </Box>
            <Divider sx={{ mt: 1.5, borderColor: 'rgba(255,255,255,.07)' }} />
          </Box>
        ))}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button disabled={busy} onClick={reset} sx={{ color: '#fbbf24', textTransform: 'none', mr: 'auto' }}>Ripristina limiti base</Button>
        <Button disabled={busy} onClick={onClose} sx={{ color: 'grey.400', textTransform: 'none' }}>Chiudi</Button>
        <Button disabled={busy || loading} onClick={save} variant="contained" sx={redBtn}>{busy ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Salva permessi'}</Button>
      </DialogActions>
    </Dialog>
  );
}

const UsersPage: React.FC = () => {
  const { user: me } = useAuth();
  const [data, setData] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [myPermissions, setMyPermissions] = useState<any>({});
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [snack, setSnack] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [banTarget, setBanTarget] = useState<any>(null);
  const [banReason, setBanReason] = useState('');
  const [premiumTarget, setPremiumTarget] = useState<any>(null);
  const [paymentsTarget, setPaymentsTarget] = useState<any>(null);
  const [permissionsTarget, setPermissionsTarget] = useState<any>(null);
  const isSuper = me?.role === 'superadmin';
  const can = (key) => isSuper || Boolean(myPermissions?.[key]);

  const load = useCallback(() => api(`/api/admin/users?q=${encodeURIComponent(q)}&role=${roleFilter}&page=${page}`).then(setData).catch((e) => setSnack({ severity: 'error', message: e.message })), [q, roleFilter, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { api('/api/admin/plans').then((d) => setPlans((d.items || []).filter((p) => p.active))).catch(() => {}); }, []);
  useEffect(() => { api('/api/admin/permissions/me').then((d) => setMyPermissions(d.permissions || {})).catch(() => {}); }, []);

  const notify = (message, severity = 'success') => setSnack({ severity, message });
  const patch = async (u, body, okMsg) => { try { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify(body) }); notify(okMsg); load(); } catch (e: any) { notify(e.message, 'error'); } };
  const forceReset = (u) => { if (window.confirm(`Forzare il reset password di ${u.email}? Al prossimo accesso vedrà un popup bloccante.`)) api(`/api/admin/users/${u.id}/force-reset`, { method: 'POST' }).then(() => { notify('Reset password forzato'); load(); }).catch((e) => notify(e.message, 'error')); };
  const remove = (u) => { if (window.confirm(`Eliminare definitivamente ${u.email}?`)) api(`/api/admin/users/${u.id}`, { method: 'DELETE' }).then(() => { notify('Utente eliminato'); load(); }).catch((e) => notify(e.message, 'error')); };
  const manageable = (u) => u.id !== me?.id && (isSuper || u.role !== 'superadmin');

  return (
    <Box data-testid="admin-users-page">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 2, mb: 3, flexDirection: { xs: 'column', sm: 'row' } }}>
        <Box>
          <Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 800, mb: 0.5 }}>Utenti</Typography>
          <Typography sx={{ color: 'grey.500', fontSize: 13.5 }}>{isSuper ? 'Gestione completa utenti e permessi Admin.' : 'Accesso limitato: puoi consultare gli utenti e usare solo le funzioni autorizzate dal Superadmin.'}</Typography>
        </Box>
        <LockedHint allowed={can('users_create')}><Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setCreateOpen(true)} sx={redBtn}>Nuovo utente</Button></LockedHint>
      </Box>

      {!isSuper && <Alert severity="info" sx={{ mb: 2.5, bgcolor: 'rgba(96,165,250,.08)', color: '#bfdbfe' }}>Ruolo Admin limitato. Le funzioni bloccate mostrano “Solo Superadmin”; il Superadmin può modificare i tuoi permessi individualmente.</Alert>}

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
        <Stat label="Totale" value={data?.stats?.total} />
        <Stat label="Premium attivi" value={data?.stats?.premium} color="#ff5a63" />
        <Stat label="Admin" value={data?.stats?.admins} color="#fbbf24" />
        <Stat label="Sospesi" value={data?.stats?.banned} color="#9ca3af" />
        <Stat label="Password da creare/reset" value={data?.stats?.pending_reset} color="#60a5fa" />
      </Box>

      <Box sx={{ ...cardSx, p: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField size="small" placeholder="Cerca per email o nome" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} sx={{ ...fieldSx, minWidth: 280 }} />
          <TextField size="small" select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} sx={{ ...fieldSx, minWidth: 160 }}><MenuItem value="">Tutti i ruoli</MenuItem>{Object.entries(ROLE_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}</TextField>
        </Box>
        {!data ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress sx={{ color: '#e50914' }} /></Box> : (
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={tableSx}>
              <thead><tr><th>Utente</th><th>Ruolo</th><th>Piano</th><th>Stato</th><th>Ultimo accesso</th><th style={{ textAlign: 'right' }}>Azioni</th></tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td><Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}><Avatar variant="rounded" src={avatarSrc(u.profileImage)} sx={{ width: 36, height: 36, borderRadius: 1.5 }} /><Box><Typography sx={{ fontWeight: 600, fontSize: 14 }}>{u.name || '—'}</Typography><Typography sx={{ color: 'grey.500', fontSize: 12.5 }}>{u.email}</Typography></Box></Box></td>
                    <td>{manageable(u) && can('users_edit') ? <TextField select size="small" value={u.role} onChange={(e) => patch(u, { role: e.target.value }, 'Ruolo aggiornato')} sx={{ ...fieldSx, minWidth: 135, '& .MuiSelect-select': { py: .6, fontSize: 13 } }}><MenuItem value="user">Utente</MenuItem><MenuItem value="admin">Admin</MenuItem>{isSuper && <MenuItem value="superadmin">Superadmin</MenuItem>}</TextField> : <Chip size="small" label={ROLE_LABEL[u.role] || u.role} sx={{ bgcolor: ROLE_COLOR[u.role], color: '#fff' }} />}</td>
                    <td><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{u.role === 'superadmin' ? <Chip size="small" label="Illimitato" sx={{ bgcolor: 'rgba(229,9,20,.2)', color: '#ff8a90' }} /> : u.is_premium ? <Chip size="small" label={u.premium?.plan_name || (u.premium?.lifetime ? 'A vita' : `Premium · ${fmtDay(u.premium?.expiresAt)}`)} sx={{ bgcolor: 'rgba(74,222,128,.12)', color: '#4ade80' }} /> : <Chip size="small" label="Gratuito" sx={{ bgcolor: 'rgba(255,255,255,.06)', color: 'grey.400' }} />}{u.role !== 'superadmin' && <LockedHint allowed={can('users_assign_plan')}><IconButton size="small" onClick={() => setPremiumTarget(u)} sx={{ color: '#ff5a63' }}><WorkspacePremiumIcon fontSize="small" /></IconButton></LockedHint>}</Box></td>
                    <td><Box sx={{ display: 'flex', gap: .5, flexWrap: 'wrap' }}>{u.banned ? <Chip size="small" label="Sospeso" sx={{ bgcolor: 'rgba(229,9,20,.25)', color: '#ff8a90' }} /> : <Chip size="small" label="Attivo" sx={{ bgcolor: 'rgba(255,255,255,.06)', color: '#ddd' }} />}{u.must_reset_password && <Chip size="small" label={u.created_by_admin ? 'Password da creare' : 'Reset pwd'} sx={{ bgcolor: 'rgba(96,165,250,.15)', color: '#93c5fd' }} />}</Box></td>
                    <td><Typography sx={{ fontSize: 12.5, color: 'grey.400' }}>{fmt(u.last_seen_at || u.last_login_at)}</Typography><Typography sx={{ fontSize: 11.5, color: 'grey.600' }}>Iscritto {fmtDay(u.createdAt)}</Typography></td>
                    <td><Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: .3 }}>
                      <LockedHint allowed={can('payments_view')}><IconButton size="small" onClick={() => setPaymentsTarget(u)} sx={{ color: 'grey.300' }}><ReceiptLongIcon fontSize="small" /></IconButton></LockedHint>
                      {isSuper && u.role === 'admin' && <Tooltip title="Permessi Admin"><IconButton size="small" onClick={() => setPermissionsTarget(u)} sx={{ color: '#a78bfa' }}><AdminPanelSettingsRoundedIcon fontSize="small" /></IconButton></Tooltip>}
                      {manageable(u) && <>
                        <LockedHint allowed={can('users_reset_password')}><IconButton size="small" onClick={() => forceReset(u)} sx={{ color: '#60a5fa' }}><LockResetIcon fontSize="small" /></IconButton></LockedHint>
                        <LockedHint allowed={can('users_edit')}><IconButton size="small" onClick={() => (u.banned ? patch(u, { banned: false }, 'Utente riattivato') : (setBanTarget(u), setBanReason('')))} sx={{ color: u.banned ? '#4ade80' : '#fbbf24' }}>{u.banned ? <CheckCircleIcon fontSize="small" /> : <BlockIcon fontSize="small" />}</IconButton></LockedHint>
                        <LockedHint allowed={can('users_delete')}><IconButton size="small" onClick={() => remove(u)} sx={{ color: '#ff5a63' }}><DeleteOutlineIcon fontSize="small" /></IconButton></LockedHint>
                      </>}
                    </Box></td>
                  </tr>
                ))}
              </tbody>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}><Typography sx={{ color: 'grey.500', fontSize: 13 }}>{data.total} utenti</Typography><Box sx={{ display: 'flex', gap: 1 }}><Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)} sx={{ color: '#fff', textTransform: 'none' }}>← Prec</Button><Button size="small" disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)} sx={{ color: '#fff', textTransform: 'none' }}>Succ →</Button></Box></Box>
          </Box>
        )}
      </Box>

      <CreateUserDialog open={createOpen} plans={plans} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); notify('Utente creato. Al primo accesso dovrà creare la password.'); setPage(1); load(); }} />
      <Dialog open={Boolean(banTarget)} onClose={() => setBanTarget(null)} PaperProps={dialogPaper}>
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>Sospendi {banTarget?.email}</DialogTitle>
        <DialogContent><TextField fullWidth multiline minRows={2} label="Motivo (mostrato all'utente)" value={banReason} onChange={(e) => setBanReason(e.target.value)} sx={fieldSx} /></DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={() => setBanTarget(null)} sx={{ color: 'grey.400', textTransform: 'none' }}>Annulla</Button><Button variant="contained" onClick={() => { patch(banTarget, { banned: true, ban_reason: banReason }, 'Utente sospeso'); setBanTarget(null); }} sx={redBtn}>Sospendi</Button></DialogActions>
      </Dialog>
      {premiumTarget && <PremiumDialog user={premiumTarget} plans={plans} onClose={() => setPremiumTarget(null)} onDone={(m) => { setPremiumTarget(null); notify(m); load(); }} />}
      {paymentsTarget && <PaymentsDialog user={paymentsTarget} canRefund={can('refunds_manage')} onClose={() => setPaymentsTarget(null)} onRefunded={() => { notify('Rimborso eseguito'); load(); }} />}
      {permissionsTarget && <AdminPermissionsDialog target={permissionsTarget} open onClose={() => setPermissionsTarget(null)} onDone={(m) => { notify(m); setPermissionsTarget(null); load(); }} />}
      <Snackbar open={Boolean(snack)} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>{snack && <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert>}</Snackbar>
    </Box>
  );
};

export default UsersPage;
