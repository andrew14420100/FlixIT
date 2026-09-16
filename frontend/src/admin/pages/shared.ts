// @ts-nocheck
export const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('admin_token')}`, 'Content-Type': 'application/json' });
export const cardSx = { bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3 };
export const dialogPaper = { sx: { bgcolor: '#141416', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3, minWidth: { xs: 320, sm: 420 } } };
export const fieldSx = { '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 2 } };
export const redBtn = { bgcolor: '#e50914', textTransform: 'none', borderRadius: 2, fontWeight: 600, '&:hover': { bgcolor: '#f6121d' } };
export const ghostBtn = { borderColor: 'rgba(255,255,255,0.2)', color: '#fff', textTransform: 'none', borderRadius: 2 };
export const tableSx = { width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px', '& th': { textAlign: 'left', color: 'grey.500', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', px: 1.5, pb: 0.5 }, '& td': { px: 1.5, py: 1.2, bgcolor: 'rgba(255,255,255,0.025)', color: '#fff', fontSize: 14, '&:first-of-type': { borderRadius: '12px 0 0 12px' }, '&:last-of-type': { borderRadius: '0 12px 12px 0' } } };
export const fmt = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('it-IT') : '—');
export const euro = (cents, cur = 'EUR') => ((cents || 0) / 100).toLocaleString('it-IT', { style: 'currency', currency: cur });
export const STATUS_IT = { paid: 'Pagato', pending: 'In attesa', refunded: 'Rimborsato', failed: 'Fallito', expired: 'Scaduto' };
export const STATUS_COLOR = { paid: '#4ade80', pending: '#fbbf24', refunded: '#60a5fa', failed: '#ff5a63', expired: '#9ca3af' };

export async function api(url, options = {}) {
  const res = await fetch(url, { headers: authHeaders(), ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Operazione fallita');
  return data;
}
