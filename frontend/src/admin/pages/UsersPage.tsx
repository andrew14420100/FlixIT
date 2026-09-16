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
import BlockIcon from '@mui/icons-material/Block';
import LockResetIcon from '@mui/icons-material/LockReset';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useAuth } from '../context/AuthContext';
import { avatarSrc } from 'src/config/avatars';
import { RefundDialog, PaymentsTable } from './PaymentsPage';
import { api, cardSx, dialogPaper, fieldSx, redBtn, tableSx, fmt, fmtDay } from './shared';

const ROLE_LABEL = { user: 'Utente', admin: 'Admin', superadmin: 'Superadmin' };
const ROLE_COLOR = { user: 'rgba(255,255,255,0.08)', admin: 'rgba(251,191,36,0.2)', superadmin: 'rgba(229,9,20,0.25)' };

function Stat({ label, value, color = '#fff', testId }) {
  return (<Box sx={{ ...cardSx, p: 2, flex: '1 1 140px' }} data-testid={testId}><Typography sx={{ color: 'grey.500', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</Typography><Typography sx={{ color, fontSize: 26, fontWeight: 800, mt: 0.3, lineHeight: 1 }}>{value ?? '—'}</Typography></Box>);
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
    <Dialog open={Boolean(user)} onClose={onClose} PaperProps={dialogPaper} data-testid="premium-dialog">
      <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>Premium · {user?.email}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ color: 'grey.400', fontSize: 13.5 }} data-testid="premium-dialog-status">Stato attuale: {user?.is_premium ? (user.premium?.lifetime ? 'Premium a vita' : `Premium fino al ${fmtDay(user.premium?.expiresAt)}`) : 'Free'}{user?.role === 'superadmin' ? ' (superadmin: accesso illimitato)' : ''}</Typography>
        <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>{MODES.map(([m, l]) => <Chip key={m} label={l} onClick={() => setMode(m)} data-testid={`premium-mode-${m}`} sx={{ bgcolor: mode === m ? '#e50914' : 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600 }} />)}</Box>
        {mode === 'plan' && <TextField select label="Piano" value={planId} onChange={(e) => setPlanId(e.target.value)} inputProps={{ 'data-testid': 'premium-plan-select' }} sx={fieldSx}>{plans.map((p) => <MenuItem key={p.id} value={p.id}>{p.name} · {p.duration_days ? `${p.duration_days} gg` : 'a vita'}</MenuItem>)}</TextField>}
        {mode === 'days' && <TextField type="number" label="Giorni da aggiungere" value={days} onChange={(e) => setDays(e.target.value)} inputProps={{ 'data-testid': 'premium-days-input', min: 1 }} sx={fieldSx} helperText="Si sommano alla scadenza attuale se il Premium è già attivo" />}
        {mode === 'date' && <TextField type="date" label="Nuova data di scadenza" InputLabelProps={{ shrink: true }} value={date} onChange={(e) => setDate(e.target.value)} inputProps={{ 'data-testid': 'premium-date-input' }} sx={fieldSx} />}
        {mode === 'lifetime' && <Alert severity="info" sx={{ bgcolor: 'rgba(96,165,250,0.1)', color: '#bfdbfe' }}>Premium permanente, nessuna scadenza.</Alert>}
        {error && <Alert severity="error" data-testid="premium-dialog-error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        {user?.is_premium && <Button disabled={busy} onClick={() => submit(true)} data-testid="premium-revoke" sx={{ color: '#ff5a63', textTransform: 'none', mr: 'auto' }}>Revoca</Button>}
        <Button onClick={onClose} sx={{ color: 'grey.400', textTransform: 'none' }}>Chiudi</Button>
        <Button variant="contained" disabled={busy || (mode === 'date' && !date) || (mode === 'plan' && !planId)} onClick={() => submit(false)} data-testid="premium-apply" sx={redBtn}>{busy ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Applica'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function PaymentsDialog({ user, onClose, onRefunded }) {
  const [items, setItems] = useState(null);
  const [refundTx, setRefundTx] = useState(null);
  const load = useCallback(() => { if (user) api(`/api/admin/users/${user.id}/payments`).then((d) => setItems(d.items)).catch(() => setItems([])); }, [user]);
  useEffect(() => { setItems(null); load(); }, [load]);
  return (
    <Dialog open={Boolean(user)} onClose={onClose} maxWidth="lg" PaperProps={{ sx: { ...dialogPaper.sx, minWidth: { md: 900 } } }} data-testid="user-payments-dialog">
      <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>Storico pagamenti · {user?.email}</DialogTitle>
      <DialogContent>
        {items === null ? <CircularProgress sx={{ color: '#e50914' }} /> : items.length === 0 ? <Typography sx={{ color: 'grey.500' }} data-testid="user-payments-empty">Nessun pagamento registrato per questo utente.</Typography> : <Box sx={{ overflowX: 'auto' }}><PaymentsTable items={items} compact onRefund={setRefundTx} /></Box>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose} sx={{ color: 'grey.400', textTransform: 'none' }}>Chiudi</Button></DialogActions>
      <RefundDialog tx={refundTx} onClose={() => setRefundTx(null)} onDone={() => { setRefundTx(null); load(); onRefunded(); }} />
    </Dialog>
  );
}

const UsersPage: React.FC = () => {
  const { user: me } = useAuth();
  const [data, setData] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [snack, setSnack] = useState<any>(null);
  const [banTarget, setBanTarget] = useState<any>(null);
  const [banReason, setBanReason] = useState('');
  const [premiumTarget, setPremiumTarget] = useState<any>(null);
  const [paymentsTarget, setPaymentsTarget] = useState<any>(null);
  const isSuper = me?.role === 'superadmin';

  const load = useCallback(() => api(`/api/admin/users?q=${encodeURIComponent(q)}&role=${roleFilter}&page=${page}`).then(setData).catch((e) => setSnack({ severity: 'error', message: e.message })), [q, roleFilter, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { api('/api/admin/plans').then((d) => setPlans(d.items.filter((p) => p.active))).catch(() => {}); }, []);

  const notify = (message, severity = 'success') => setSnack({ severity, message });
  const patch = async (u, body, okMsg) => { try { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify(body) }); notify(okMsg); load(); } catch (e: any) { notify(e.message, 'error'); } };
  const forceReset = (u) => { if (window.confirm(`Forzare il reset password di ${u.email}? Al prossimo accesso vedrà un popup bloccante.`)) api(`/api/admin/users/${u.id}/force-reset`, { method: 'POST' }).then(() => { notify('Reset password forzato'); load(); }).catch((e) => notify(e.message, 'error')); };
  const remove = (u) => { if (window.confirm(`Eliminare definitivamente ${u.email}?`)) api(`/api/admin/users/${u.id}`, { method: 'DELETE' }).then(() => { notify('Utente eliminato'); load(); }).catch((e) => notify(e.message, 'error')); };
  const canManage = (u) => u.id !== me?.id && (isSuper || u.role !== 'superadmin');

  return (
    <Box data-testid="admin-users-page">
      <Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 800, mb: 0.5 }}>Utenti</Typography>
      <Typography sx={{ color: 'grey.500', fontSize: 13.5, mb: 3 }}>Ruoli, Premium, sospensioni, reset password e storico pagamenti.</Typography>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
        <Stat label="Totale" value={data?.stats?.total} testId="users-stat-total" />
        <Stat label="Premium attivi" value={data?.stats?.premium} color="#ff5a63" testId="users-stat-premium" />
        <Stat label="Admin" value={data?.stats?.admins} color="#fbbf24" testId="users-stat-admins" />
        <Stat label="Sospesi" value={data?.stats?.banned} color="#9ca3af" testId="users-stat-banned" />
        <Stat label="Reset in attesa" value={data?.stats?.pending_reset} color="#60a5fa" testId="users-stat-reset" />
      </Box>
      <Box sx={{ ...cardSx, p: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField size="small" placeholder="Cerca per email o nome" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} inputProps={{ 'data-testid': 'users-search-input' }} sx={{ ...fieldSx, minWidth: 280 }} />
          <TextField size="small" select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} inputProps={{ 'data-testid': 'users-role-filter' }} sx={{ ...fieldSx, minWidth: 160 }}>
            <MenuItem value="">Tutti i ruoli</MenuItem>{Object.entries(ROLE_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
        </Box>
        {!data ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress sx={{ color: '#e50914' }} /></Box> : (
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={tableSx} data-testid="users-table">
              <thead><tr><th>Utente</th><th>Ruolo</th><th>Premium</th><th>Stato</th><th>Ultimo accesso</th><th style={{ textAlign: 'right' }}>Azioni</th></tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} data-testid={`user-row-${u.id}`}>
                    <td><Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}><Avatar variant="rounded" src={avatarSrc(u.profileImage)} sx={{ width: 36, height: 36, borderRadius: 1.5 }} /><Box><Typography sx={{ fontWeight: 600, fontSize: 14 }}>{u.name || '—'}</Typography><Typography sx={{ color: 'grey.500', fontSize: 12.5 }} data-testid={`user-email-${u.id}`}>{u.email}</Typography></Box></Box></td>
                    <td>
                      {canManage(u) ? (
                        <TextField select size="small" value={u.role} onChange={(e) => patch(u, { role: e.target.value }, 'Ruolo aggiornato')} inputProps={{ 'data-testid': `user-role-select-${u.id}` }} sx={{ ...fieldSx, minWidth: 140, '& .MuiSelect-select': { py: 0.6, fontSize: 13 } }}>
                          <MenuItem value="user">Utente</MenuItem><MenuItem value="admin">Admin</MenuItem>{isSuper && <MenuItem value="superadmin">Superadmin</MenuItem>}
                        </TextField>
                      ) : <Chip size="small" label={ROLE_LABEL[u.role] || u.role} data-testid={`user-role-chip-${u.id}`} sx={{ bgcolor: ROLE_COLOR[u.role], color: '#fff', fontWeight: 600 }} />}
                    </td>
                    <td>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {u.role === 'superadmin' ? <Chip size="small" icon={<WorkspacePremiumIcon sx={{ fontSize: 15 }} />} label="Illimitato" sx={{ bgcolor: 'rgba(229,9,20,0.2)', color: '#ff8a90', fontWeight: 600 }} />
                          : u.is_premium ? <Chip size="small" icon={<CheckCircleIcon sx={{ fontSize: 15, color: '#4ade80 !important' }} />} label={u.premium?.lifetime ? 'A vita' : `Fino al ${fmtDay(u.premium?.expiresAt)}`} data-testid={`user-premium-${u.id}`} sx={{ bgcolor: 'rgba(74,222,128,0.12)', color: '#4ade80', fontWeight: 600 }} />
                          : <Chip size="small" label="Free" data-testid={`user-premium-${u.id}`} sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: 'grey.400' }} />}
                        {u.role !== 'superadmin' && <Tooltip title="Gestisci Premium"><IconButton size="small" onClick={() => setPremiumTarget(u)} data-testid={`user-premium-manage-${u.id}`} sx={{ color: '#ff5a63' }}><WorkspacePremiumIcon fontSize="small" /></IconButton></Tooltip>}
                      </Box>
                    </td>
                    <td>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {u.banned ? <Tooltip title={u.ban_reason || ''}><Chip size="small" label="Sospeso" data-testid={`user-banned-${u.id}`} sx={{ bgcolor: 'rgba(229,9,20,0.25)', color: '#ff8a90', fontWeight: 600 }} /></Tooltip> : <Chip size="small" label="Attivo" sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#ddd' }} />}
                        {u.must_reset_password && <Chip size="small" label="Reset pwd" data-testid={`user-reset-flag-${u.id}`} sx={{ bgcolor: 'rgba(96,165,250,0.15)', color: '#93c5fd', fontWeight: 600 }} />}
                      </Box>
                    </td>
                    <td><Typography sx={{ fontSize: 12.5, color: 'grey.400' }}>{fmt(u.last_seen_at || u.last_login_at)}</Typography><Typography sx={{ fontSize: 11.5, color: 'grey.600' }}>Iscritto {fmtDay(u.createdAt)}</Typography></td>
                    <td>
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.3 }}>
                        <Tooltip title="Storico pagamenti"><IconButton size="small" onClick={() => setPaymentsTarget(u)} data-testid={`user-payments-${u.id}`} sx={{ color: 'grey.300' }}><ReceiptLongIcon fontSize="small" /></IconButton></Tooltip>
                        {canManage(u) && <>
                          <Tooltip title="Forza reset password"><IconButton size="small" onClick={() => forceReset(u)} data-testid={`user-force-reset-${u.id}`} sx={{ color: '#60a5fa' }}><LockResetIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title={u.banned ? 'Riattiva' : 'Sospendi'}><IconButton size="small" onClick={() => (u.banned ? patch(u, { banned: false }, 'Utente riattivato') : (setBanTarget(u), setBanReason('')))} data-testid={`user-ban-toggle-${u.id}`} sx={{ color: u.banned ? '#4ade80' : '#fbbf24' }}>{u.banned ? <CheckCircleIcon fontSize="small" /> : <BlockIcon fontSize="small" />}</IconButton></Tooltip>
                          <Tooltip title="Elimina"><IconButton size="small" onClick={() => remove(u)} data-testid={`user-delete-${u.id}`} sx={{ color: '#ff5a63' }}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                        </>}
                      </Box>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
              <Typography sx={{ color: 'grey.500', fontSize: 13 }}>{data.total} utenti</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}><Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)} sx={{ color: '#fff', textTransform: 'none' }}>← Prec</Button><Button size="small" disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)} sx={{ color: '#fff', textTransform: 'none' }}>Succ →</Button></Box>
            </Box>
          </Box>
        )}
      </Box>

      <Dialog open={Boolean(banTarget)} onClose={() => setBanTarget(null)} PaperProps={dialogPaper} data-testid="ban-dialog">
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>Sospendi {banTarget?.email}</DialogTitle>
        <DialogContent><TextField fullWidth multiline minRows={2} label="Motivo (mostrato all'utente)" value={banReason} onChange={(e) => setBanReason(e.target.value)} inputProps={{ 'data-testid': 'ban-reason-input' }} sx={fieldSx} /></DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={() => setBanTarget(null)} sx={{ color: 'grey.400', textTransform: 'none' }}>Annulla</Button><Button variant="contained" onClick={() => { patch(banTarget, { banned: true, ban_reason: banReason }, 'Utente sospeso'); setBanTarget(null); }} data-testid="ban-confirm" sx={redBtn}>Sospendi</Button></DialogActions>
      </Dialog>
      {premiumTarget && <PremiumDialog user={premiumTarget} plans={plans} onClose={() => setPremiumTarget(null)} onDone={(m) => { setPremiumTarget(null); notify(m); load(); }} />}
      {paymentsTarget && <PaymentsDialog user={paymentsTarget} onClose={() => setPaymentsTarget(null)} onRefunded={() => { notify('Rimborso eseguito'); load(); }} />}
      <Snackbar open={Boolean(snack)} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snack && <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} data-testid="users-snackbar">{snack.message}</Alert>}
      </Snackbar>
    </Box>
  );
};

export default UsersPage;
