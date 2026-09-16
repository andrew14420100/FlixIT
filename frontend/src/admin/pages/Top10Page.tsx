// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Tooltip from '@mui/material/Tooltip';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';

const API_URL = ""; // Use relative path - routed via ingress to backend

interface Top10Content {
  tmdbId: number;
  type: string;
  position: number;
  title: string;
  poster_path: string;
  backdrop_path: string;
  vote_average: number;
}

interface SearchResult {
  tmdbId: number;
  type: string;
  title: string;
  poster_path: string;
  release_date: string;
  vote_average: number;
}

const Top10Page: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [contents, setContents] = useState<Top10Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<number>(1);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const getAuthToken = () => localStorage.getItem('admin_token');

  const loadData = useCallback(async () => {
    try {
      const token = getAuthToken();
      const [settingsRes, contentsRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/top10/settings`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/admin/top10/contents`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        setEnabled(settings.enabled || false);
      }

      if (contentsRes.ok) {
        const data = await contentsRes.json();
        setContents(data.items || []);
      }
    } catch (error) {
      console.error('Errore caricamento:', error);
      showSnackbar('Errore nel caricamento', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleToggleEnabled = async () => {
    setUpdating(true);
    try {
      const token = getAuthToken();
      console.log('Toggle with token:', token ? 'present' : 'missing');
      const newEnabled = !enabled;
      const response = await fetch(`${API_URL}/api/admin/top10/settings?enabled=${newEnabled}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('Toggle response status:', response.status);
      if (response.ok) {
        const data = await response.json();
        console.log('Toggle result:', data);
        setEnabled(newEnabled);
        showSnackbar(`Top 10 ${newEnabled ? 'attivata' : 'disattivata'}`, 'success');
      } else {
        const errorText = await response.text();
        console.error('Toggle error:', errorText);
        showSnackbar('Errore nell\'aggiornamento: ' + response.status, 'error');
      }
    } catch (err) {
      console.error('Toggle exception:', err);
      showSnackbar('Errore nell\'aggiornamento', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setSearching(true);
    try {
      const token = getAuthToken();
      console.log('Searching with token:', token ? 'present' : 'missing');
      const response = await fetch(
        `${API_URL}/api/admin/tmdb/search?query=${encodeURIComponent(searchQuery)}&type=multi`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      console.log('Search response status:', response.status);
      if (response.ok) {
        const data = await response.json();
        console.log('Search results:', data);
        setSearchResults(data.items || []);
        if (!data.items || data.items.length === 0) {
          showSnackbar('Nessun risultato trovato', 'error');
        }
      } else {
        const errorText = await response.text();
        console.error('Search error:', errorText);
        showSnackbar('Errore nella ricerca: ' + response.status, 'error');
      }
    } catch (err) {
      console.error('Search exception:', err);
      showSnackbar('Errore nella ricerca', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleAddContent = async (item: SearchResult) => {
    setUpdating(true);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_URL}/api/admin/top10/contents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tmdbId: item.tmdbId,
          type: item.type,
          position: selectedPosition
        })
      });

      if (response.ok) {
        showSnackbar(`"${item.title}" aggiunto alla posizione ${selectedPosition}`, 'success');
        setDialogOpen(false);
        setSearchQuery('');
        setSearchResults([]);
        loadData();
      } else {
        const error = await response.json();
        showSnackbar(error.detail || 'Errore nell\'aggiunta', 'error');
      }
    } catch {
      showSnackbar('Errore nell\'aggiunta', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handleRemoveContent = async (tmdbId: number) => {
    setUpdating(true);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_URL}/api/admin/top10/contents/${tmdbId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        showSnackbar('Contenuto rimosso', 'success');
        loadData();
      } else {
        showSnackbar('Errore nella rimozione', 'error');
      }
    } catch {
      showSnackbar('Errore nella rimozione', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const openAddDialog = (position: number) => {
    setSelectedPosition(position);
    setSearchQuery('');
    setSearchResults([]);
    setDialogOpen(true);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress sx={{ color: '#e50914' }} />
      </Box>
    );
  }

  // Create array of 10 positions
  const positions = Array.from({ length: 10 }, (_, i) => i + 1);

  return (
    <Box data-testid="top10-page">
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <EmojiEventsIcon sx={{ color: '#fbbf24', fontSize: 32 }} />
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#fff' }}>
              Top 10 Titoli Oggi
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: 'grey.500', mt: 0.5 }}>
            Gestisci la sezione Top 10 visibile sulla homepage
          </Typography>
        </Box>
        
        {/* Enable/Disable Toggle */}
        <Paper
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 3,
            py: 1.5,
            bgcolor: enabled ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${enabled ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            borderRadius: 2,
          }}
        >
          <Typography sx={{ color: enabled ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
            {enabled ? 'Sezione Attiva' : 'Sezione Disattivata'}
          </Typography>
          <Switch
            checked={enabled}
            onChange={handleToggleEnabled}
            disabled={updating}
            data-testid="top10-toggle"
            sx={{
              '& .MuiSwitch-switchBase.Mui-checked': { color: '#22c55e' },
              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#22c55e' },
            }}
          />
        </Paper>
      </Box>

      {/* Top 10 Grid */}
      <Paper
        elevation={0}
        sx={{
          bgcolor: 'rgba(20, 20, 20, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 3,
          p: 3,
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              sm: 'repeat(3, 1fr)',
              md: 'repeat(5, 1fr)',
            },
            gap: 3,
          }}
        >
          {positions.map((pos) => {
            const content = contents.find((c) => c.position === pos);
            
            return (
              <Paper
                key={pos}
                sx={{
                  bgcolor: 'rgba(30, 30, 30, 0.8)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  position: 'relative',
                  aspectRatio: '2/3',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    border: '1px solid rgba(229,9,20,0.5)',
                    transform: 'scale(1.02)',
                  },
                }}
                onClick={() => !content && openAddDialog(pos)}
                data-testid={`position-${pos}`}
              >
                {/* Position Badge */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    bgcolor: '#e50914',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                  }}
                >
                  <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>
                    {pos}
                  </Typography>
                </Box>

                {content ? (
                  <>
                    {/* Content Poster */}
                    <Box
                      component="img"
                      src={`https://image.tmdb.org/t/p/w300${content.poster_path}`}
                      alt={content.title}
                      sx={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                    
                    {/* Overlay */}
                    <Box
                      sx={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        p: 1.5,
                        background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
                      }}
                    >
                      <Typography
                        sx={{
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {content.title}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                        {content.type === 'movie' ? (
                          <MovieIcon sx={{ fontSize: 12, color: '#3b82f6' }} />
                        ) : (
                          <TvIcon sx={{ fontSize: 12, color: '#8b5cf6' }} />
                        )}
                        <Typography sx={{ color: 'grey.400', fontSize: 10 }}>
                          {content.type === 'movie' ? 'Film' : 'Serie TV'}
                        </Typography>
                      </Box>
                    </Box>

                    {/* Delete Button */}
                    <Tooltip title="Rimuovi">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveContent(content.tmdbId);
                        }}
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          bgcolor: 'rgba(0,0,0,0.7)',
                          color: '#fff',
                          '&:hover': { bgcolor: '#e50914' },
                        }}
                        data-testid={`remove-${pos}`}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </>
                ) : (
                  // Empty Slot
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      gap: 1,
                    }}
                  >
                    <AddIcon sx={{ fontSize: 40, color: 'grey.600' }} />
                    <Typography sx={{ color: 'grey.500', fontSize: 12 }}>
                      Aggiungi contenuto
                    </Typography>
                  </Box>
                )}
              </Paper>
            );
          })}
        </Box>
      </Paper>

      {/* Info Alert */}
      <Box sx={{ mt: 4 }}>
        <Alert
          severity="info"
          icon={<InfoOutlinedIcon />}
          sx={{
            bgcolor: 'rgba(59, 130, 246, 0.08)',
            color: 'grey.300',
            border: '1px solid rgba(59, 130, 246, 0.15)',
            borderRadius: 2,
            '& .MuiAlert-icon': { color: '#3b82f6' },
          }}
        >
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
            Come funziona la Top 10
          </Typography>
          <Typography variant="body2" sx={{ color: 'grey.400' }}>
            Seleziona fino a 10 titoli da mostrare nella sezione Top 10 sulla homepage.
            Attiva la sezione con l'interruttore per renderla visibile agli utenti.
            Puoi cercare qualsiasi film o serie TV e assegnarlo a una posizione specifica.
          </Typography>
        </Alert>
      </Box>

      {/* Add Content Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 3,
          },
        }}
      >
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>
          Aggiungi alla Posizione #{selectedPosition}
        </DialogTitle>
        <DialogContent>
          {/* Search Box */}
          <TextField
            fullWidth
            placeholder="Cerca film o serie TV..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: 'grey.500' }} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleSearch}
                    disabled={searching || !searchQuery.trim()}
                    sx={{ bgcolor: '#e50914', '&:hover': { bgcolor: '#b20710' } }}
                  >
                    {searching ? <CircularProgress size={20} /> : 'Cerca'}
                  </Button>
                </InputAdornment>
              ),
            }}
            sx={{
              mt: 2,
              '& .MuiOutlinedInput-root': { bgcolor: '#2a2a2a' },
            }}
            data-testid="search-input"
          />

          {/* Search Results */}
          {searchResults.length > 0 && (
            <Box sx={{ mt: 3, maxHeight: 400, overflow: 'auto' }}>
              {searchResults.map((item) => (
                <Paper
                  key={item.tmdbId}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    p: 2,
                    mb: 1,
                    bgcolor: '#2a2a2a',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      bgcolor: '#3a3a3a',
                      transform: 'translateX(4px)',
                    },
                  }}
                  onClick={() => handleAddContent(item)}
                  data-testid={`search-result-${item.tmdbId}`}
                >
                  {item.poster_path ? (
                    <Box
                      component="img"
                      src={`https://image.tmdb.org/t/p/w92${item.poster_path}`}
                      alt={item.title}
                      sx={{ width: 50, height: 75, objectFit: 'cover', borderRadius: 1 }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: 50,
                        height: 75,
                        bgcolor: '#3a3a3a',
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {item.type === 'movie' ? (
                        <MovieIcon sx={{ color: 'grey.600' }} />
                      ) : (
                        <TvIcon sx={{ color: 'grey.600' }} />
                      )}
                    </Box>
                  )}
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ color: '#fff', fontWeight: 600 }}>
                      {item.title}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      {item.type === 'movie' ? (
                        <MovieIcon sx={{ fontSize: 14, color: '#3b82f6' }} />
                      ) : (
                        <TvIcon sx={{ fontSize: 14, color: '#8b5cf6' }} />
                      )}
                      <Typography sx={{ color: 'grey.400', fontSize: 12 }}>
                        {item.type === 'movie' ? 'Film' : 'Serie TV'}
                      </Typography>
                      {item.release_date && (
                        <Typography sx={{ color: 'grey.500', fontSize: 12 }}>
                          • {item.release_date.split('-')[0]}
                        </Typography>
                      )}
                      {item.vote_average > 0 && (
                        <Typography sx={{ color: '#fbbf24', fontSize: 12, fontWeight: 600 }}>
                          ★ {item.vote_average.toFixed(1)}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  <Button
                    variant="outlined"
                    size="small"
                    sx={{
                      color: '#e50914',
                      borderColor: '#e50914',
                      '&:hover': { bgcolor: 'rgba(229,9,20,0.1)' },
                    }}
                  >
                    Seleziona
                  </Button>
                </Paper>
              ))}
            </Box>
          )}

          {searchQuery && searchResults.length === 0 && !searching && (
            <Box sx={{ mt: 3, textAlign: 'center', py: 4 }}>
              <Typography sx={{ color: 'grey.500' }}>
                Nessun risultato trovato per "{searchQuery}"
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: 'grey.400' }}>
            Chiudi
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ borderRadius: 2 }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Top10Page;
