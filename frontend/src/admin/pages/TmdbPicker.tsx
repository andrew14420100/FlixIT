// @ts-nocheck
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import { fieldSx } from './shared';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w92';

// Searches TMDB titles via the public search endpoint and returns {tmdbId, type, title, poster_path} on pick.
export default function TmdbPicker({ onPick, testId = 'tmdb-picker' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/public/search?q=${encodeURIComponent(q)}&limit=12`).then((r) => r.json()).then((d) => setResults(d.items || [])).catch(() => setResults([])).finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Box data-testid={testId}>
      <TextField fullWidth size="small" placeholder="Cerca un film o una serie su TMDB…" value={q} onChange={(e) => setQ(e.target.value)} inputProps={{ 'data-testid': `${testId}-input` }} sx={fieldSx} InputProps={{ endAdornment: loading ? <CircularProgress size={16} sx={{ color: '#e50914' }} /> : null }} />
      {results.length > 0 && (
        <Box sx={{ mt: 1, maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {results.map((r) => (
            <Box key={`${r.type}-${r.tmdbId}`} component="button" type="button" onClick={() => { onPick(r); setQ(''); setResults([]); }} data-testid={`${testId}-result-${r.tmdbId}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 0.8, borderRadius: 2, border: '1px solid transparent', bgcolor: 'rgba(255,255,255,0.03)', color: '#fff', cursor: 'pointer', textAlign: 'left', '&:hover': { bgcolor: 'rgba(229,9,20,0.12)', borderColor: 'rgba(229,9,20,0.4)' } }}>
              <Box sx={{ width: 36, height: 54, borderRadius: 1, overflow: 'hidden', bgcolor: '#222', flexShrink: 0 }}>{r.poster_path && <img src={`${TMDB_IMG}${r.poster_path}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ fontSize: 14, fontWeight: 600 }}>{r.title}</Typography><Typography sx={{ fontSize: 12, color: 'grey.500' }}>{(r.release_date || '').slice(0, 4)} · TMDB {r.tmdbId}</Typography></Box>
              <Chip size="small" label={r.type === 'tv' ? 'Serie' : 'Film'} sx={{ bgcolor: 'rgba(255,255,255,0.08)', color: '#ddd' }} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
