// @ts-nocheck
import { filterAvailableAsync } from "src/hooks/useAvailability";
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import MovieIcon from "@mui/icons-material/Movie";
import TvIcon from "@mui/icons-material/Tv";
import StarIcon from "@mui/icons-material/Star";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = "4f153630f8d7e92d542dde3a38fbddf2";

export default function SearchBox() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${TMDB_API}/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&language=it-IT&page=1`);
        if (res.ok) {
          const data = await res.json();
          const candidates = (data.results || []).filter(i => i.media_type === "movie" || i.media_type === "tv");
          setResults((await filterAvailableAsync(candidates)).slice(0, 8));
        }
      } catch {} finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) { setOpen(false); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100); }, [open]);

  return (
    <Box ref={containerRef} sx={{ position: "relative" }} data-testid="search-box">
      {/* Toggle Button / Input */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: '6px',
        bgcolor: open ? 'rgba(255,255,255,0.08)' : 'transparent',
        border: open ? '1px solid rgba(255,255,255,0.15)' : '1px solid transparent',
        borderRadius: '10px', px: open ? 1.5 : 0.7, py: 0.5,
        transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
        width: open ? { xs: '240px', md: '380px' } : '42px',
        height: '42px',
        overflow: 'hidden',
        cursor: open ? 'text' : 'pointer',
        '&:hover': !open ? { bgcolor: 'rgba(255,255,255,0.06)', borderRadius: '8px' } : {},
      }}
        onClick={() => { if (!open) setOpen(true); }}
      >
        <SearchIcon sx={{ fontSize: 24, color: open ? '#fff' : 'rgba(255,255,255,0.75)', flexShrink: 0, transition: 'color 0.2s' }} />
        {open && (
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca film, serie TV..."
            data-testid="search-input"
            style={{
              background: 'none', border: 'none', outline: 'none',
              color: '#fff', fontSize: '15px', fontFamily: "'Inter', sans-serif",
              width: '100%', padding: 0,
            }}
          />
        )}
        {open && query && (
          <CloseIcon
            onClick={(e) => { e.stopPropagation(); setQuery(""); setResults([]); }}
            sx={{ fontSize: 19, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', flexShrink: 0, '&:hover': { color: '#fff' } }}
          />
        )}
        {loading && <CircularProgress size={14} sx={{ color: '#E50914', flexShrink: 0 }} />}
      </Box>

      {/* Results Dropdown */}
      {open && results.length > 0 && (
        <Box sx={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: { xs: '300px', md: '400px' },
          bgcolor: 'rgba(12,12,12,0.97)', backdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden', zIndex: 1100,
        }}>
          <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Risultati
            </Typography>
          </Box>
          {results.map((r) => (
            <Box
              key={`${r.media_type}-${r.id}`}
              onClick={() => { navigate(`/browse/${r.media_type}/${r.id}`); setQuery(""); setOpen(false); }}
              data-testid={`search-result-${r.id}`}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1,
                cursor: 'pointer', transition: 'background 0.15s',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
              }}
            >
              <Box sx={{ width: 36, height: 52, borderRadius: '6px', overflow: 'hidden', bgcolor: '#1a1a1a', flexShrink: 0 }}>
                {r.poster_path ? (
                  <img src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : r.media_type === "movie" ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><MovieIcon sx={{ color: '#333', fontSize: 18 }} /></Box>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><TvIcon sx={{ color: '#333', fontSize: 18 }} /></Box>
                )}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.title || r.name}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mt: 0.3 }}>
                  <Typography sx={{ fontSize: 10.5, color: r.media_type === 'movie' ? '#3b82f6' : '#a78bfa', fontWeight: 600 }}>
                    {r.media_type === 'movie' ? 'Film' : 'Serie TV'}
                  </Typography>
                  {(r.release_date || r.first_air_date) && (
                    <Typography sx={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)' }}>
                      {(r.release_date || r.first_air_date).split('-')[0]}
                    </Typography>
                  )}
                  {r.vote_average > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <StarIcon sx={{ fontSize: 10, color: '#f5c518' }} />
                      <Typography sx={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>{r.vote_average.toFixed(1)}</Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {open && query.length >= 2 && results.length === 0 && !loading && (
        <Box sx={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: { xs: '260px', md: '300px' },
          bgcolor: 'rgba(12,12,12,0.97)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', p: 3, textAlign: 'center', zIndex: 1100,
        }}>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Nessun risultato</Typography>
        </Box>
      )}
    </Box>
  );
}
