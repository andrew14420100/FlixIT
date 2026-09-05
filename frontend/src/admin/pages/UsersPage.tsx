// @ts-nocheck
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Avatar from '@mui/material/Avatar';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import BlockIcon from '@mui/icons-material/Block';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import LockResetIcon from '@mui/icons-material/LockReset';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import SearchIcon from '@mui/icons-material/Search';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import { avatarSrc } from 'src/config/avatars';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('admin_token')}`, 'Content-Type': 'application/json' });
const cardSx = { bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3 };
const dialogPaper = { sx: { bgcolor: '#141416', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3, minWidth: 380 } };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

function StatCard({ label, value, color = '#fff', testId }) {
  return (
    <Box sx={{ ...cardSx, p: 2.5, flex: '1 1 160px' }} data-testid={testId}>
      <Typography sx={{ color: 'grey.500', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</Typography>
      <Typography sx={{ color, fontSize: 30, fontWeight: 800, mt: 0.5, lineHeight: 1 }}>{value}</Typography>
    </Box>
  );
}

const UsersPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<any>(null); // {type: 'ban'|'delete'|'notice', user}
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<any>(null);

  const load = async (query = q) => {
    const res = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}`, { headers: authHeaders() });
    if (res.ok) setData(await res.json());
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => load(q), 300); return () => clearTimeout(t); }, [q]);

  const call = async (url, options, okMsg) => {
    setBusy(true);
    try {
      const res = await fetch(url, { headers: authHeaders(), ...options });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'Operazione fallita');
      setSnack({ severity: 'success', message: okMsg });
      await load();
      setDialog(null);
    } catch (e: any) {
      setSnack({ severity: 'error', message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const patch = (u, body, msg) => call(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify(body) }, msg);

  return (
    <Box data-testid="admin-users-page">
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <StatCard label="Utenti" value={data?.stats?.total ?? '—'} testId="users-stat-total" />
        <StatCard label="Premium" value={data?.stats?.premium ?? '—'} color="#f5c518" testId="users-stat-premium" />
        <StatCard label="Bannati" value={data?.stats?.banned ?? '—'} color="#ff5a63" testId="users-stat-banned" />
        <StatCard label="Reset in attesa" value={data?.stats?.pending_reset ?? '—'} color="#fbbf24" testId="users-stat-reset" />
      </Box>

      <Box sx={{ ...cardSx, p: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', mb: 2 }}>
          <TextField size="small" placeholder="Cerca per nome o email" value={q} onChange={(e) => setQ(e.target.value)} inputProps={{ 'data-testid': 'users-search-input' }}
            InputProps={{ startAdornment: <SearchIcon sx={{ color: 'grey.600', mr: 1, fontSize: 20 }} /> }} sx={{ minWidth: 300, '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 2 } }} />
          <Button variant="outlined" startIcon={<CampaignOutlinedIcon />} onClick={() => { setNotice({ title: '', body: '' }); setDialog({ type: 'notice', user: null }); }} data-testid="users-broadcast-button"
            sx={{ borderColor: 'rgba(255,255,255,0.2)', color: '#fff', textTransform: 'none', borderRadius: 2 }}>Comunicazione a tutti</Button>
        </Box>

        {!data ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress sx={{ color: '#e50914' }} /></Box> : (
          <Box component="table" data-testid="users-table" sx={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px', '& th': { textAlign: 'left', color: 'grey.500', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', px: 1.5, pb: 0.5 }, '& td': { px: 1.5, py: 1.2, bgcolor: 'rgba(255,255,255,0.025)', color: '#fff', fontSize: 14, '&:first-of-type': { borderRadius: '12px 0 0 12px' }, '&:last-of-type': { borderRadius: '0 12px 12px 0' } } }}>
            <thead><tr><th>Utente</th><th>Ruolo</th><th>Stato</th><th>Ultimo accesso</th><th>Ticket</th><th style={{ textAlign: 'right' }}>Azioni</th></tr></thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} data-testid={`user-row-${u.id}`}>
                  <td>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar variant="rounded" src={u.profileImage ? avatarSrc(u.profileImage) : undefined} sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: '#2a2a2a' }} />
                      <Box><Typography sx={{ fontWeight: 600, fontSize: 14 }}>{u.name}</Typography><Typography sx={{ color: 'grey.500', fontSize: 12.5 }}>{u.email}</Typography></Box>
                    </Box>
                  </td>
                  <td>
                    <Select size="small" value={u.role} onChange={(e) => patch(u, { role: e.target.value }, 'Ruolo aggiornato')} data-testid={`user-role-${u.id}`}
                      sx={{ fontSize: 13, minWidth: 130, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.04)', color: u.role === 'premium' ? '#f5c518' : '#fff' }}>
                      <MenuItem value="user">Utente</MenuItem>
                      <MenuItem value="premium"><WorkspacePremiumIcon sx={{ fontSize: 16, mr: 0.8, color: '#f5c518' }} />Premium</MenuItem>
                    </Select>
                  </td>
                  <td>
                    <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
                      {u.banned ? <Chip size="small" label={`Bannato${u.ban_reason ? ` · ${u.ban_reason}` : ''}`} data-testid={`user-status-banned-${u.id}`} sx={{ bgcolor: 'rgba(229,9,20,0.18)', color: '#ff5a63', fontWeight: 600 }} />
                        : <Chip size="small" label="Attivo" data-testid={`user-status-active-${u.id}`} sx={{ bgcolor: 'rgba(34,197,94,0.14)', color: '#4ade80', fontWeight: 600 }} />}
                      {u.must_reset_password && <Chip size="small" label="Reset richiesto" data-testid={`user-status-reset-${u.id}`} sx={{ bgcolor: 'rgba(251,191,36,0.14)', color: '#fbbf24', fontWeight: 600 }} />}
                    </Box>
                  </td>
                  <td><Typography sx={{ fontSize: 13, color: 'grey.400' }}>{fmt(u.last_seen_at || u.last_login_at)}</Typography></td>
                  <td><Typography sx={{ fontSize: 13, color: u.open_tickets ? '#fbbf24' : 'grey.500' }}>{u.open_tickets} aperti</Typography></td>
                  <td>
                    <Box sx={{ display: 'flex', gap: 0.3, justifyContent: 'flex-end' }}>
                      <Tooltip title="Invia comunicazione"><IconButton size="small" onClick={() => { setNotice({ title: '', body: '' }); setDialog({ type: 'notice', user: u }); }} data-testid={`user-notify-${u.id}`} sx={{ color: 'grey.300' }}><CampaignOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Richiedi reset password"><IconButton size="small" disabled={u.must_reset_password} onClick={() => call(`/api/admin/users/${u.id}/force-reset`, { method: 'POST' }, 'Reset password richiesto')} data-testid={`user-force-reset-${u.id}`} sx={{ color: '#fbbf24' }}><LockResetIcon fontSize="small" /></IconButton></Tooltip>
                      {u.banned ? (
                        <Tooltip title="Sblocca"><IconButton size="small" onClick={() => patch(u, { banned: false }, 'Utente sbloccato')} data-testid={`user-unban-${u.id}`} sx={{ color: '#4ade80' }}><LockOpenIcon fontSize="small" /></IconButton></Tooltip>
                      ) : (
                        <Tooltip title="Banna"><IconButton size="small" onClick={() => { setReason(''); setDialog({ type: 'ban', user: u }); }} data-testid={`user-ban-${u.id}`} sx={{ color: '#ff5a63' }}><BlockIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                      <Tooltip title="Elimina account"><IconButton size="small" onClick={() => setDialog({ type: 'delete', user: u })} data-testid={`user-delete-${u.id}`} sx={{ color: 'grey.500' }}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                    </Box>
                  </td>
                </tr>
              ))}
            </tbody>
          </Box>
        )}
        {data && data.items.length === 0 && <Typography sx={{ color: 'grey.500', textAlign: 'center', py: 4 }} data-testid="users-empty">Nessun utente trovato</Typography>}
      </Box>

      <Dialog open={dialog?.type === 'ban'} onClose={() => setDialog(null)} PaperProps={dialogPaper} data-testid="ban-dialog">
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>Banna {dialog?.user?.name}</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'grey.400', fontSize: 14, mb: 2 }}>L'utente non potrà più accedere e le sessioni aperte verranno chiuse. Il motivo (opzionale) verrà mostrato all'utente.</Typography>
          <TextField fullWidth multiline minRows={2} placeholder="Motivo (opzionale)" value={reason} onChange={(e) => setReason(e.target.value)} inputProps={{ 'data-testid': 'ban-reason-input' }} sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 2 } }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog(null)} sx={{ color: 'grey.400', textTransform: 'none' }}>Annulla</Button>
          <Button variant="contained" disabled={busy} onClick={() => patch(dialog.user, { banned: true, ban_reason: reason }, 'Utente bannato')} data-testid="ban-confirm" sx={{ bgcolor: '#e50914', textTransform: 'none', borderRadius: 2, '&:hover': { bgcolor: '#f6121d' } }}>Conferma ban</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog?.type === 'delete'} onClose={() => setDialog(null)} PaperProps={dialogPaper} data-testid="delete-dialog">
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>Eliminare {dialog?.user?.email}?</DialogTitle>
        <DialogContent><Typography sx={{ color: 'grey.400', fontSize: 14 }}>Azione irreversibile: account, lista e cronologia verranno rimossi.</Typography></DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog(null)} sx={{ color: 'grey.400', textTransform: 'none' }}>Annulla</Button>
          <Button variant="contained" disabled={busy} onClick={() => call(`/api/admin/users/${dialog.user.id}`, { method: 'DELETE' }, 'Account eliminato')} data-testid="delete-confirm" sx={{ bgcolor: '#e50914', textTransform: 'none', borderRadius: 2 }}>Elimina</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog?.type === 'notice'} onClose={() => setDialog(null)} PaperProps={dialogPaper} data-testid="notice-dialog">
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>{dialog?.user ? `Comunicazione a ${dialog.user.name}` : 'Comunicazione a tutti gli utenti'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField fullWidth placeholder="Titolo" value={notice.title} onChange={(e) => setNotice({ ...notice, title: e.target.value })} inputProps={{ 'data-testid': 'notice-title-input' }} sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 2 } }} />
          <TextField fullWidth multiline minRows={3} placeholder="Testo del messaggio" value={notice.body} onChange={(e) => setNotice({ ...notice, body: e.target.value })} inputProps={{ 'data-testid': 'notice-body-input' }} sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 2 } }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog(null)} sx={{ color: 'grey.400', textTransform: 'none' }}>Annulla</Button>
          <Button variant="contained" disabled={busy || !notice.title.trim() || !notice.body.trim()} data-testid="notice-send"
            onClick={() => call('/api/admin/notifications/send', { method: 'POST', body: JSON.stringify({ user_id: dialog?.user?.id || null, ...notice }) }, 'Comunicazione inviata')}
            sx={{ bgcolor: '#e50914', textTransform: 'none', borderRadius: 2, '&:hover': { bgcolor: '#f6121d' } }}>Invia</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(snack)} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snack && <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} data-testid="users-snackbar">{snack.message}</Alert>}
      </Snackbar>
    </Box>
  );
};

export default UsersPage;
