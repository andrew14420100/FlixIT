// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import SearchIcon from '@mui/icons-material/Search';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import TicketThread from 'src/components/support/TicketThread';
import { StatusChip, STATUS_META, fmtDate } from 'src/components/support/ticketUi';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('admin_token')}`, 'Content-Type': 'application/json' });
const cardSx = { bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3 };
const FILTERS = [{ key: 'all', label: 'Tutti' }, { key: 'open', label: 'Aperti' }, { key: 'in_progress', label: 'In lavorazione' }, { key: 'closed', label: 'Chiusi' }];

const TicketsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const selected = params.get('id');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState<any>(null);

  const load = async () => {
    const qs = new URLSearchParams();
    if (status !== 'all') qs.set('status', status);
    if (q) qs.set('q', q);
    const res = await fetch(`/api/admin/tickets?${qs}`, { headers: authHeaders() });
    if (res.ok) setData(await res.json());
  };
  useEffect(() => { load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [status, q]);

  const select = (id) => { const next = new URLSearchParams(params); if (id) next.set('id', id); else next.delete('id'); setParams(next, { replace: true }); };

  const setTicketStatus = async (id, value) => {
    await fetch(`/api/admin/tickets/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status: value }) });
    load();
  };

  const counts = data?.counts || {};
  const total = (counts.open || 0) + (counts.in_progress || 0) + (counts.closed || 0);

  return (
    <Box data-testid="admin-tickets-page" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '380px 1fr' }, gap: 2.5, alignItems: 'start' }}>
      <Box sx={{ ...cardSx, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, maxHeight: 'calc(100vh - 140px)' }}>
        <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const n = f.key === 'all' ? total : counts[f.key] || 0;
            const on = status === f.key;
            return (
              <Box key={f.key} component="button" type="button" onClick={() => setStatus(f.key)} data-testid={`tickets-filter-${f.key}`}
                sx={{ px: 1.4, py: 0.7, borderRadius: 999, border: `1px solid ${on ? 'rgba(229,9,20,0.7)' : 'rgba(255,255,255,0.1)'}`, bgcolor: on ? 'rgba(229,9,20,0.15)' : 'transparent', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: "'Inter', sans-serif", display: 'flex', gap: 0.6, alignItems: 'center' }}>
                {f.label}<Box component="span" sx={{ color: on ? '#ff5a63' : 'grey.500' }}>{n}</Box>
              </Box>
            );
          })}
        </Box>
        <TextField size="small" placeholder="Cerca oggetto o email" value={q} onChange={(e) => setQ(e.target.value)} inputProps={{ 'data-testid': 'tickets-search-input' }}
          InputProps={{ startAdornment: <SearchIcon sx={{ color: 'grey.600', mr: 1, fontSize: 20 }} /> }} sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 2 } }} />

        <Box data-testid="admin-tickets-list" sx={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.8, pr: 0.3 }}>
          {!data ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={26} sx={{ color: '#e50914' }} /></Box>
            : data.items.length === 0 ? <Typography data-testid="admin-tickets-empty" sx={{ color: 'grey.500', textAlign: 'center', py: 4, fontSize: 14 }}>Nessun ticket</Typography>
            : data.items.map((t) => {
              const on = t.id === selected;
              return (
                <Box key={t.id} component="button" type="button" onClick={() => select(t.id)} data-testid={`admin-ticket-row-${t.id}`}
                  sx={{ textAlign: 'left', p: 1.6, borderRadius: '12px', border: `1px solid ${on ? 'rgba(229,9,20,0.6)' : 'rgba(255,255,255,0.07)'}`, bgcolor: on ? 'rgba(229,9,20,0.1)' : 'rgba(255,255,255,0.02)', color: '#fff', cursor: 'pointer', fontFamily: "'Inter', sans-serif", transition: 'background-color 150ms ease', '&:hover': { bgcolor: on ? 'rgba(229,9,20,0.14)' : 'rgba(255,255,255,0.06)' } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
                    <Typography noWrap sx={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{t.subject}</Typography>
                    {t.unread > 0 && <Box data-testid={`admin-ticket-unread-${t.id}`} sx={{ px: 0.8, borderRadius: 999, bgcolor: '#e50914', fontSize: 11, fontWeight: 800 }}>{t.unread}</Box>}
                    <StatusChip status={t.status} />
                  </Box>
                  <Typography noWrap sx={{ fontSize: 12.5, color: 'grey.400' }}>{t.user_email} · {t.last_sender === 'admin' ? 'Tu' : 'Utente'}: {t.last_preview}</Typography>
                  <Typography sx={{ fontSize: 11, color: 'grey.600', mt: 0.3 }}>{fmtDate(t.updated_at)}</Typography>
                </Box>
              );
            })}
        </Box>
      </Box>

      <Box sx={{ ...cardSx, p: 2.5, minHeight: 480 }}>
        {selected ? (
          <TicketThread key={selected} ticketId={selected} token={localStorage.getItem('admin_token')} mine="admin" endpoint="/api/admin/tickets" categories={data?.categories || []} onChanged={load}
            extraHeader={(ticket) => (
              <Select size="small" value={ticket.status} onChange={(e) => setTicketStatus(ticket.id, e.target.value)} data-testid="admin-ticket-status-select"
                sx={{ fontSize: 13, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.05)', color: '#fff', '& .MuiSelect-select': { py: 0.7 } }}>
                {Object.entries(STATUS_META).map(([k, m]) => <MenuItem key={k} value={k}>{m.label}</MenuItem>)}
              </Select>
            )} />
        ) : (
          <Box data-testid="admin-ticket-placeholder" sx={{ height: 440, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'grey.600', gap: 1 }}>
            <ConfirmationNumberOutlinedIcon sx={{ fontSize: 48, color: 'grey.700' }} />
            <Typography sx={{ fontSize: 15 }}>Seleziona un ticket per leggere la conversazione</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default TicketsPage;
