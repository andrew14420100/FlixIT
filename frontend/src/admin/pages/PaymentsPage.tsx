// @ts-nocheck
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import ReplayIcon from '@mui/icons-material/Replay';
import { api, cardSx, dialogPaper, fieldSx, redBtn, tableSx, fmt, euro, STATUS_IT, STATUS_COLOR } from './shared';

function Stat({ label, value, color = '#fff', testId }) {
  return (<Box sx={{ ...cardSx, p: 2.5, flex: '1 1 160px' }} data-testid={testId}><Typography sx={{ color: 'grey.500', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</Typography><Typography sx={{ color, fontSize: 28, fontWeight: 800, mt: 0.5, lineHeight: 1 }}>{value}</Typography></Box>);
}

export function RefundDialog({ tx, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const refund = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/api/admin/payments/${tx.id}/refund`, { method: 'POST', body: JSON.stringify({ amount_cents: amount ? Math.round(Number(amount) * 100) : null }) });
      onDone();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={Boolean(tx)} onClose={onClose} PaperProps={dialogPaper} data-testid="refund-dialog">
      <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>Rimborsa pagamento</DialogTitle>
      {tx && (
        <DialogContent>
          <Typography sx={{ color: 'grey.400', fontSize: 14, mb: 2 }}>{tx.user_email} · {tx.plan_name} · {euro(tx.amount_cents, tx.currency)} via {tx.provider === 'stripe' ? 'Stripe' : 'PayPal'}. Il rimborso viene eseguito sul provider; se il Premium dell'utente deriva da questo pagamento verrà revocato.</Typography>
          <TextField fullWidth label="Importo parziale in € (vuoto = totale)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} inputProps={{ 'data-testid': 'refund-amount-input', step: '0.01', min: 0.5 }} sx={fieldSx} />
          {error && <Alert severity="error" sx={{ mt: 2 }} data-testid="refund-error">{error}</Alert>}
        </DialogContent>
      )}
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: 'grey.400', textTransform: 'none' }}>Annulla</Button>
        <Button variant="contained" disabled={busy} onClick={refund} data-testid="refund-confirm" sx={redBtn}>{busy ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Conferma rimborso'}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function PaymentsTable({ items, onRefund, compact = false }) {
  return (
    <Box component="table" sx={tableSx} data-testid="payments-table">
      <thead><tr><th>Data</th>{!compact && <th>Utente</th>}<th>Piano</th><th>Importo</th><th>Provider</th><th>Stato</th><th>Riferimento</th><th style={{ textAlign: 'right' }}>Azioni</th></tr></thead>
      <tbody>
        {items.map((t) => (
          <tr key={t.id} data-testid={`payment-row-${t.id}`}>
            <td><Typography sx={{ fontSize: 13, color: 'grey.300' }}>{fmt(t.created_at)}</Typography></td>
            {!compact && <td><Typography sx={{ fontSize: 13.5 }}>{t.user_email}</Typography></td>}
            <td>{t.plan_name}</td>
            <td><Typography sx={{ fontWeight: 700 }}>{euro(t.amount_cents, t.currency)}</Typography></td>
            <td><Chip size="small" label={t.provider === 'stripe' ? 'Stripe' : 'PayPal'} sx={{ bgcolor: t.provider === 'stripe' ? 'rgba(99,91,255,0.2)' : 'rgba(0,112,186,0.25)', color: '#fff', fontWeight: 600 }} /></td>
            <td><Chip size="small" label={STATUS_IT[t.status] || t.status} data-testid={`payment-status-${t.id}`} sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: STATUS_COLOR[t.status] || '#fff', fontWeight: 600 }} /></td>
            <td><Typography sx={{ fontSize: 11.5, color: 'grey.500', fontFamily: 'monospace' }}>{t.provider_payment_id || t.session_id || t.order_id || t.id.slice(0, 8)}</Typography>{t.refund_id && <Typography sx={{ fontSize: 11, color: '#60a5fa' }}>Rimborso {t.refund_id}</Typography>}</td>
            <td style={{ textAlign: 'right' }}>{t.status === 'paid' && <Button size="small" startIcon={<ReplayIcon />} onClick={() => onRefund(t)} data-testid={`payment-refund-${t.id}`} sx={{ color: '#fbbf24', textTransform: 'none' }}>Rimborsa</Button>}</td>
          </tr>
        ))}
      </tbody>
    </Box>
  );
}

const PaymentsPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [refundTx, setRefundTx] = useState(null);
  const [snack, setSnack] = useState<any>(null);
  const load = () => api(`/api/admin/payments?status=${status}&q=${encodeURIComponent(q)}`).then(setData).catch(() => {});
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [status, q]);

  return (
    <Box data-testid="admin-payments-page">
      <Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 800, mb: 0.5 }}>Pagamenti</Typography>
      <Typography sx={{ color: 'grey.500', fontSize: 13.5, mb: 3 }}>Solo riferimenti delle transazioni Stripe/PayPal: nessun dato di carta viene salvato.</Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Stat label="Incasso" value={euro(data?.stats?.revenue_cents)} color="#4ade80" testId="payments-stat-revenue" />
        <Stat label="Pagati" value={data?.stats?.paid ?? '—'} testId="payments-stat-paid" />
        <Stat label="Rimborsati" value={data?.stats?.refunded ?? '—'} color="#60a5fa" testId="payments-stat-refunded" />
        <Stat label="In attesa" value={data?.stats?.pending ?? '—'} color="#fbbf24" testId="payments-stat-pending" />
      </Box>
      <Box sx={{ ...cardSx, p: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField size="small" placeholder="Cerca per email o ID" value={q} onChange={(e) => setQ(e.target.value)} inputProps={{ 'data-testid': 'payments-search-input' }} sx={{ ...fieldSx, minWidth: 280 }} />
          <TextField size="small" select value={status} onChange={(e) => setStatus(e.target.value)} inputProps={{ 'data-testid': 'payments-status-filter' }} sx={{ ...fieldSx, minWidth: 180 }}>
            <MenuItem value="">Tutti gli stati</MenuItem>{Object.entries(STATUS_IT).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
        </Box>
        {!data ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress sx={{ color: '#e50914' }} /></Box>
          : data.items.length === 0 ? <Typography sx={{ color: 'grey.500', textAlign: 'center', py: 4 }} data-testid="payments-empty">Nessuna transazione</Typography>
          : <Box sx={{ overflowX: 'auto' }}><PaymentsTable items={data.items} onRefund={setRefundTx} /></Box>}
      </Box>
      <RefundDialog tx={refundTx} onClose={() => setRefundTx(null)} onDone={() => { setRefundTx(null); setSnack({ severity: 'success', message: 'Rimborso eseguito' }); load(); }} />
      <Snackbar open={Boolean(snack)} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {snack && <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} data-testid="payments-snackbar">{snack.message}</Alert>}
      </Snackbar>
    </Box>
  );
};

export default PaymentsPage;
