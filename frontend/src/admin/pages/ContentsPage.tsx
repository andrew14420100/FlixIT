// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import InputAdornment from '@mui/material/InputAdornment';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardMedia from '@mui/material/CardMedia';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Tooltip from '@mui/material/Tooltip';
import Fade from '@mui/material/Fade';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import ImageIcon from '@mui/icons-material/Image';
import { adminAPI } from '../services/api';
import { tmdbService } from '../services/tmdb';
import type { Content, ContentWithTMDB, TMDBSearchResult } from '../types';

type FilterType = 'all' | 'visible' | 'hidden' | 'movie' | 'tv';
type ViewMode = 'table' | 'grid';

const ContentsPage: React.FC = () => {
  const [contents, setContents] = useState<ContentWithTMDB[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Search TMDB Dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [tmdbSearchQuery, setTmdbSearchQuery] = useState('');
  const [tmdbSearchType, setTmdbSearchType] = useState<'movie' | 'tv'>('movie');
  const [tmdbResults, setTmdbResults] = useState<TMDBSearchResult[]>([]);
  const [tmdbSearching, setTmdbSearching] = useState(false);
  const [addingContent, setAddingContent] = useState<number | null>(null);
  const [existingTmdbIds, setExistingTmdbIds] = useState<Set<number>>(new Set());

  // Edit/Delete dialogs
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedContent, setSelectedContent] = useState<ContentWithTMDB | null>(null);
  const [editSeason, setEditSeason] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const loadContents = useCallback(async () => {
    setLoading(true);
    try {
      const params: { available?: boolean; type?: string; page: number; limit: number } = {
        page: page + 1,
        limit: rowsPerPage,
      };

      if (filter === 'visible') params.available = true;
      if (filter === 'hidden') params.available = false;
      if (filter === 'movie') params.type = 'movie';
      if (filter === 'tv') params.type = 'tv';

      const data = await adminAPI.getContents(params);
      setTotal(data.total);

      // Store existing TMDB IDs
      const ids = new Set<number>();
      
      // Fetch TMDB details
      const contentsWithTMDB = await Promise.all(
        data.items.map(async (content: Content) => {
          ids.add(content.tmdbId);
          const tmdbData = await tmdbService.getDetails(content.tmdbId, content.type);
          return {
            ...content,
            title: tmdbData?.title,
            name: tmdbData?.name,
            poster_path: tmdbData?.poster_path,
            backdrop_path: tmdbData?.backdrop_path,
            overview: tmdbData?.overview,
            vote_average: tmdbData?.vote_average,
            release_date: tmdbData?.release_date,
            first_air_date: tmdbData?.first_air_date,
          } as ContentWithTMDB;
        })
      );
      
      setExistingTmdbIds(ids);

      // Client-side search filter
      let filtered = contentsWithTMDB;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = contentsWithTMDB.filter((c) =>
          (c.title || c.name || '').toLowerCase().includes(query)
        );
      }

      setContents(filtered);
    } catch (error) {
      console.error('Errore caricamento contenuti:', error);
      showSnackbar('Errore nel caricamento', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, filter, searchQuery]);

  useEffect(() => {
    loadContents();
  }, [loadContents]);

  // Load all existing IDs when dialog opens
  useEffect(() => {
    if (addDialogOpen) {
      const loadAllIds = async () => {
        try {
          const allData = await adminAPI.getContents({ limit: 1000 });
          const ids = new Set(allData.items.map((c: Content) => c.tmdbId));
          setExistingTmdbIds(ids);
        } catch (e) {
          console.error('Error loading IDs:', e);
        }
      };
      loadAllIds();
    }
  }, [addDialogOpen]);

  const showSnackbar = (message: string, severity: 'success' | 'error'): void => {
    setSnackbar({ open: true, message, severity });
  };

  // Search TMDB
  const handleTmdbSearch = async (): Promise<void> => {
    if (!tmdbSearchQuery.trim()) return;
    setTmdbSearching(true);
    try {
      const results = await tmdbService.search(tmdbSearchQuery, tmdbSearchType);
      setTmdbResults(results);
    } catch (error) {
      showSnackbar('Errore nella ricerca', 'error');
    } finally {
      setTmdbSearching(false);
    }
  };

  const handleAddFromTmdb = async (result: TMDBSearchResult): Promise<void> => {
    setAddingContent(result.id);
    try {
      await adminAPI.createContent({
        tmdbId: result.id,
        type: tmdbSearchType,
        available: true,
      });
      showSnackbar(`"${result.title || result.name}" aggiunto con successo!`, 'success');
      setExistingTmdbIds(prev => new Set([...prev, result.id]));
      loadContents();
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Errore', 'error');
    } finally {
      setAddingContent(null);
    }
  };

  const handleToggleAvailable = async (content: ContentWithTMDB): Promise<void> => {
    try {
      await adminAPI.updateContent(content.tmdbId, { available: !content.available });
      showSnackbar(
        `"${content.title || content.name}" ${!content.available ? 'visibile' : 'nascosto'}`,
        'success'
      );
      loadContents();
    } catch {
      showSnackbar("Errore nell'aggiornamento", 'error');
    }
  };

  const handleUpdateSeason = async (): Promise<void> => {
    if (!selectedContent) return;
    setFormLoading(true);
    try {
      await adminAPI.updateContent(selectedContent.tmdbId, {
        availableSeason: editSeason ? parseInt(editSeason) : null,
      });
      showSnackbar('Stagione aggiornata', 'success');
      setEditDialogOpen(false);
      loadContents();
    } catch {
      showSnackbar("Errore nell'aggiornamento", 'error');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!selectedContent) return;
    setFormLoading(true);
    try {
      await adminAPI.deleteContent(selectedContent.tmdbId);
      showSnackbar('Contenuto eliminato', 'success');
      setDeleteDialogOpen(false);
      loadContents();
    } catch {
      showSnackbar("Errore nell'eliminazione", 'error');
    } finally {
      setFormLoading(false);
    }
  };

  const filterOptions: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'Tutti' },
    { key: 'visible', label: 'Visibili' },
    { key: 'hidden', label: 'Nascosti' },
    { key: 'movie', label: 'Film' },
    { key: 'tv', label: 'Serie TV' },
  ];

  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('it-IT', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <Box data-testid="contents-page">
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: '#fff' }}>
            Catalogo Contenuti
          </Typography>
          <Typography variant="body2" sx={{ color: 'grey.500', mt: 0.5 }}>
            Gestisci film e serie TV dal database TMDB
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setAddDialogOpen(true);
            setTmdbResults([]);
            setTmdbSearchQuery('');
          }}
          data-testid="add-content-btn"
          sx={{
            bgcolor: '#e50914',
            px: 3,
            py: 1.25,
            borderRadius: 2,
            fontWeight: 600,
            textTransform: 'none',
            '&:hover': { bgcolor: '#b20710', transform: 'translateY(-2px)' },
            transition: 'all 0.2s',
          }}
        >
          Aggiungi da TMDB
        </Button>
      </Box>

      {/* Search & Filters */}
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          mb: 3,
          bgcolor: 'rgba(20, 20, 20, 0.6)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 3,
        }}
      >
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <TextField
            placeholder="Cerca nel catalogo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            size="small"
            sx={{
              minWidth: 280,
              '& .MuiOutlinedInput-root': {
                bgcolor: 'rgba(255,255,255,0.03)',
                borderRadius: 2,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
              },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: 'grey.500' }} />
                </InputAdornment>
              ),
            }}
            inputProps={{ 'data-testid': 'search-input' }}
          />

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {filterOptions.map((f) => (
              <Chip
                key={f.key}
                label={f.label}
                onClick={() => {
                  setFilter(f.key);
                  setPage(0);
                }}
                data-testid={`filter-${f.key}`}
                sx={{
                  bgcolor: filter === f.key ? '#e50914' : 'rgba(255,255,255,0.06)',
                  color: filter === f.key ? '#fff' : 'grey.400',
                  fontWeight: filter === f.key ? 600 : 400,
                  borderRadius: '20px',
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: filter === f.key ? '#b20710' : 'rgba(255,255,255,0.1)',
                    transform: 'scale(1.05)',
                  },
                }}
              />
            ))}

            <Box sx={{ ml: 2, display: 'flex', gap: 0.5, bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 2, p: 0.5 }}>
              <IconButton
                size="small"
                onClick={() => setViewMode('grid')}
                sx={{
                  color: viewMode === 'grid' ? '#e50914' : 'grey.500',
                  bgcolor: viewMode === 'grid' ? 'rgba(229,9,20,0.15)' : 'transparent',
                  borderRadius: 1.5,
                }}
              >
                <ImageIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => setViewMode('table')}
                sx={{
                  color: viewMode === 'table' ? '#e50914' : 'grey.500',
                  bgcolor: viewMode === 'table' ? 'rgba(229,9,20,0.15)' : 'transparent',
                  borderRadius: 1.5,
                }}
              >
                <MovieIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </Box>
      </Paper>

      {/* Content Display */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress sx={{ color: '#e50914' }} />
        </Box>
      ) : viewMode === 'grid' ? (
        // Grid View
        <Grid container spacing={2.5}>
          {contents.map((content) => (
            <Grid item xs={6} sm={4} md={3} lg={2} key={content.tmdbId}>
              <Fade in timeout={300}>
                <Card
                  sx={{
                    bgcolor: 'rgba(20, 20, 20, 0.8)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 2,
                    overflow: 'hidden',
                    transition: 'all 0.3s ease',
                    opacity: content.available ? 1 : 0.5,
                    '&:hover': {
                      transform: 'scale(1.03)',
                      borderColor: '#e50914',
                      boxShadow: '0 8px 30px rgba(229,9,20,0.2)',
                    },
                  }}
                >
                  <Box sx={{ position: 'relative' }}>
                    <CardMedia
                      component="img"
                      image={tmdbService.getImageUrl(content.poster_path, 'w342')}
                      alt={content.title || content.name}
                      sx={{ aspectRatio: '2/3', objectFit: 'cover' }}
                    />
                    {/* Overlay badges */}
                    <Box sx={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 0.5 }}>
                      <Chip
                        size="small"
                        icon={content.type === 'movie' ? <MovieIcon sx={{ fontSize: 14 }} /> : <TvIcon sx={{ fontSize: 14 }} />}
                        label={content.type === 'movie' ? 'Film' : 'TV'}
                        sx={{
                          height: 24,
                          fontSize: 11,
                          bgcolor: 'rgba(0,0,0,0.75)',
                          backdropFilter: 'blur(4px)',
                          color: '#fff',
                          '& .MuiChip-icon': { color: content.type === 'movie' ? '#3b82f6' : '#8b5cf6' },
                        }}
                      />
                    </Box>
                    {content.vote_average && (
                      <Box
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          bgcolor: 'rgba(0,0,0,0.75)',
                          backdropFilter: 'blur(4px)',
                          borderRadius: 1,
                          px: 1,
                          py: 0.25,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                        }}
                      >
                        <StarIcon sx={{ fontSize: 14, color: '#fbbf24' }} />
                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                          {content.vote_average.toFixed(1)}
                        </Typography>
                      </Box>
                    )}
                    {/* Quick actions overlay */}
                    <Box
                      sx={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        p: 1.5,
                        background: 'linear-gradient(transparent, rgba(0,0,0,0.95))',
                        display: 'flex',
                        justifyContent: 'center',
                        gap: 1,
                        opacity: 0,
                        transition: 'opacity 0.2s',
                        '.MuiCard-root:hover &': { opacity: 1 },
                      }}
                    >
                      <Tooltip title={content.available ? 'Nascondi' : 'Mostra'}>
                        <IconButton
                          size="small"
                          onClick={() => handleToggleAvailable(content)}
                          sx={{
                            bgcolor: content.available ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.1)',
                            color: content.available ? '#22c55e' : 'grey.400',
                            '&:hover': { bgcolor: content.available ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.2)' },
                          }}
                        >
                          {content.available ? <CheckCircleIcon fontSize="small" /> : <CheckCircleIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                      {content.type === 'tv' && (
                        <Tooltip title="Modifica stagione">
                          <IconButton
                            size="small"
                            onClick={() => {
                              setSelectedContent(content);
                              setEditSeason(content.availableSeason?.toString() || '');
                              setEditDialogOpen(true);
                            }}
                            sx={{
                              bgcolor: 'rgba(255,255,255,0.1)',
                              color: 'grey.300',
                              '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Elimina">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setSelectedContent(content);
                            setDeleteDialogOpen(true);
                          }}
                          sx={{
                            bgcolor: 'rgba(229,9,20,0.2)',
                            color: '#e50914',
                            '&:hover': { bgcolor: 'rgba(229,9,20,0.3)' },
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                  <CardContent sx={{ p: 1.5, pb: '12px !important' }}>
                    <Typography
                      sx={{
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: 13,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {content.title || content.name}
                    </Typography>
                    <Typography sx={{ color: 'grey.500', fontSize: 11, mt: 0.5 }}>
                      {formatDate(content.release_date || content.first_air_date)}
                      {content.type === 'tv' && content.availableSeason && ` • S${content.availableSeason}`}
                    </Typography>
                  </CardContent>
                </Card>
              </Fade>
            </Grid>
          ))}
        </Grid>
      ) : (
        // Table View
        <Paper
          elevation={0}
          sx={{
            bgcolor: 'rgba(20, 20, 20, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.3)' }}>
                  <TableCell sx={{ color: 'grey.500', borderColor: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>Poster</TableCell>
                  <TableCell sx={{ color: 'grey.500', borderColor: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>Titolo</TableCell>
                  <TableCell sx={{ color: 'grey.500', borderColor: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>Tipo</TableCell>
                  <TableCell sx={{ color: 'grey.500', borderColor: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>Voto</TableCell>
                  <TableCell sx={{ color: 'grey.500', borderColor: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>Visibile</TableCell>
                  <TableCell sx={{ color: 'grey.500', borderColor: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>Azioni</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {contents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 8, borderColor: 'rgba(255,255,255,0.06)', color: 'grey.500' }}>
                      Nessun contenuto trovato
                    </TableCell>
                  </TableRow>
                ) : (
                  contents.map((content) => (
                    <TableRow
                      key={content.tmdbId}
                      sx={{
                        opacity: content.available ? 1 : 0.5,
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' },
                      }}
                    >
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <Box
                          component="img"
                          src={tmdbService.getImageUrl(content.poster_path, 'w92')}
                          alt=""
                          sx={{ width: 45, height: 68, borderRadius: 1, objectFit: 'cover' }}
                        />
                      </TableCell>
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <Typography sx={{ color: '#fff', fontWeight: 500, fontSize: 14 }}>
                          {content.title || content.name}
                        </Typography>
                        <Typography sx={{ color: 'grey.500', fontSize: 12 }}>
                          {formatDate(content.release_date || content.first_air_date)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <Chip
                          size="small"
                          icon={content.type === 'movie' ? <MovieIcon sx={{ fontSize: 14 }} /> : <TvIcon sx={{ fontSize: 14 }} />}
                          label={content.type === 'movie' ? 'Film' : 'Serie TV'}
                          sx={{
                            bgcolor: content.type === 'movie' ? 'rgba(59,130,246,0.15)' : 'rgba(139,92,246,0.15)',
                            color: content.type === 'movie' ? '#3b82f6' : '#8b5cf6',
                            fontWeight: 500,
                            '& .MuiChip-icon': { color: 'inherit' },
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <StarIcon sx={{ fontSize: 16, color: '#fbbf24' }} />
                          <Typography sx={{ color: '#fff', fontWeight: 500 }}>
                            {content.vote_average?.toFixed(1) || 'N/A'}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <Switch
                          checked={content.available}
                          onChange={() => handleToggleAvailable(content)}
                          sx={{
                            '& .MuiSwitch-switchBase.Mui-checked': { color: '#22c55e' },
                            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#22c55e' },
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        {content.type === 'tv' && (
                          <IconButton
                            size="small"
                            onClick={() => {
                              setSelectedContent(content);
                              setEditSeason(content.availableSeason?.toString() || '');
                              setEditDialogOpen(true);
                            }}
                            sx={{ color: 'grey.400', '&:hover': { color: '#fff' } }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        )}
                        <IconButton
                          size="small"
                          onClick={() => {
                            setSelectedContent(content);
                            setDeleteDialogOpen(true);
                          }}
                          sx={{ color: '#e50914', '&:hover': { color: '#ff4444' } }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Pagination */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          labelRowsPerPage="Per pagina:"
          sx={{ color: 'grey.400' }}
        />
      </Box>

      {/* Add from TMDB Dialog */}
      <Dialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: '#141414',
            borderRadius: 3,
            maxHeight: '90vh',
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid rgba(255,255,255,0.06)', pb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Cerca su TMDB</Typography>
          <Typography variant="body2" sx={{ color: 'grey.500', mt: 0.5 }}>
            Cerca film o serie TV da aggiungere al catalogo
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: '24px !important' }}>
          {/* Search Controls */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            <Tabs
              value={tmdbSearchType}
              onChange={(_, v) => setTmdbSearchType(v)}
              sx={{
                minHeight: 40,
                '& .MuiTab-root': {
                  minHeight: 40,
                  textTransform: 'none',
                  fontWeight: 600,
                },
                '& .Mui-selected': { color: '#e50914 !important' },
                '& .MuiTabs-indicator': { bgcolor: '#e50914' },
              }}
            >
              <Tab value="movie" label="Film" icon={<MovieIcon sx={{ fontSize: 18 }} />} iconPosition="start" />
              <Tab value="tv" label="Serie TV" icon={<TvIcon sx={{ fontSize: 18 }} />} iconPosition="start" />
            </Tabs>
            
            <TextField
              placeholder={`Cerca ${tmdbSearchType === 'movie' ? 'film' : 'serie TV'}...`}
              value={tmdbSearchQuery}
              onChange={(e) => setTmdbSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTmdbSearch()}
              size="small"
              sx={{
                flex: 1,
                minWidth: 250,
                '& .MuiOutlinedInput-root': {
                  bgcolor: 'rgba(255,255,255,0.03)',
                  borderRadius: 2,
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'grey.500' }} />
                  </InputAdornment>
                ),
                endAdornment: tmdbSearching && (
                  <InputAdornment position="end">
                    <CircularProgress size={20} sx={{ color: '#e50914' }} />
                  </InputAdornment>
                ),
              }}
            />
            
            <Button
              variant="contained"
              onClick={handleTmdbSearch}
              disabled={tmdbSearching || !tmdbSearchQuery.trim()}
              sx={{
                bgcolor: '#e50914',
                px: 4,
                borderRadius: 2,
                textTransform: 'none',
                fontWeight: 600,
                '&:hover': { bgcolor: '#b20710' },
              }}
            >
              Cerca
            </Button>
          </Box>

          {/* Results */}
          {tmdbResults.length > 0 ? (
            <Grid container spacing={2}>
              {tmdbResults.map((result) => {
                const isAdded = existingTmdbIds.has(result.id);
                const isAdding = addingContent === result.id;
                
                return (
                  <Grid item xs={6} sm={4} md={3} lg={2.4} key={result.id}>
                    <Card
                      sx={{
                        bgcolor: 'rgba(30, 30, 30, 0.8)',
                        border: isAdded ? '2px solid #22c55e' : '1px solid rgba(255,255,255,0.06)',
                        borderRadius: 2,
                        overflow: 'hidden',
                        transition: 'all 0.2s',
                        '&:hover': {
                          transform: isAdded ? 'none' : 'scale(1.02)',
                          borderColor: isAdded ? '#22c55e' : '#e50914',
                        },
                      }}
                    >
                      <Box sx={{ position: 'relative' }}>
                        <CardMedia
                          component="img"
                          image={tmdbService.getImageUrl(result.poster_path, 'w342')}
                          alt={result.title || result.name}
                          sx={{ aspectRatio: '2/3', objectFit: 'cover' }}
                        />
                        {isAdded && (
                          <Box
                            sx={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              bgcolor: 'rgba(34,197,94,0.2)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <CheckCircleIcon sx={{ fontSize: 48, color: '#22c55e' }} />
                          </Box>
                        )}
                        {result.vote_average > 0 && (
                          <Box
                            sx={{
                              position: 'absolute',
                              top: 8,
                              right: 8,
                              bgcolor: 'rgba(0,0,0,0.75)',
                              borderRadius: 1,
                              px: 0.75,
                              py: 0.25,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                            }}
                          >
                            <StarIcon sx={{ fontSize: 12, color: '#fbbf24' }} />
                            <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>
                              {result.vote_average.toFixed(1)}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                      <CardContent sx={{ p: 1.5 }}>
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
                          {result.title || result.name}
                        </Typography>
                        <Typography sx={{ color: 'grey.500', fontSize: 11 }}>
                          {formatDate(result.release_date || result.first_air_date)}
                        </Typography>
                      </CardContent>
                      <CardActions sx={{ p: 1.5, pt: 0 }}>
                        <Button
                          fullWidth
                          size="small"
                          variant={isAdded ? 'outlined' : 'contained'}
                          disabled={isAdded || isAdding}
                          onClick={() => handleAddFromTmdb(result)}
                          startIcon={isAdding ? <CircularProgress size={14} /> : isAdded ? <CheckCircleIcon /> : <AddIcon />}
                          sx={{
                            bgcolor: isAdded ? 'transparent' : '#e50914',
                            borderColor: isAdded ? '#22c55e' : undefined,
                            color: isAdded ? '#22c55e' : '#fff',
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: 12,
                            '&:hover': {
                              bgcolor: isAdded ? 'transparent' : '#b20710',
                            },
                            '&.Mui-disabled': {
                              bgcolor: isAdded ? 'transparent' : 'rgba(229,9,20,0.4)',
                              color: isAdded ? '#22c55e' : 'rgba(255,255,255,0.5)',
                              borderColor: isAdded ? '#22c55e' : undefined,
                            },
                          }}
                        >
                          {isAdding ? 'Aggiunta...' : isAdded ? 'Aggiunto' : 'Aggiungi'}
                        </Button>
                      </CardActions>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          ) : tmdbSearchQuery && !tmdbSearching ? (
            <Box sx={{ py: 8, textAlign: 'center' }}>
              <Typography sx={{ color: 'grey.500' }}>
                Nessun risultato trovato. Prova con un'altra ricerca.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ py: 8, textAlign: 'center' }}>
              <SearchIcon sx={{ fontSize: 64, color: 'grey.700', mb: 2 }} />
              <Typography sx={{ color: 'grey.500' }}>
                Cerca un titolo per iniziare
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Button
            onClick={() => setAddDialogOpen(false)}
            sx={{ color: 'grey.400', textTransform: 'none' }}
          >
            Chiudi
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Season Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#1a1a1a', borderRadius: 3 } }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          Modifica Stagione Disponibile
        </DialogTitle>
        <DialogContent sx={{ pt: '24px !important' }}>
          <TextField
            fullWidth
            label="Stagione Disponibile"
            type="number"
            value={editSeason}
            onChange={(e) => setEditSeason(e.target.value)}
            helperText="Lascia vuoto se tutte le stagioni sono disponibili"
            inputProps={{ 'data-testid': 'edit-season-input' }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Button onClick={() => setEditDialogOpen(false)} sx={{ color: 'grey.400' }}>
            Annulla
          </Button>
          <Button
            onClick={handleUpdateSeason}
            variant="contained"
            disabled={formLoading}
            sx={{ bgcolor: '#e50914', '&:hover': { bgcolor: '#b20710' } }}
          >
            {formLoading ? <CircularProgress size={20} /> : 'Salva'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        PaperProps={{ sx: { bgcolor: '#1a1a1a', borderRadius: 3 } }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          Conferma Eliminazione
        </DialogTitle>
        <DialogContent sx={{ pt: '24px !important' }}>
  <Typography>
    Sei sicuro di voler eliminare{' '}
    <strong>
      {String(selectedContent?.title ?? selectedContent?.name ?? '')}
    </strong>
    ?
  </Typography>

  <Typography variant="body2" sx={{ color: 'grey.500', mt: 1 }}>
    Questa azione non può essere annullata.
  </Typography>
</DialogContent>
        <DialogActions sx={{ p: 3, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Button onClick={() => setDeleteDialogOpen(false)} sx={{ color: 'grey.400' }}>
            Annulla
          </Button>
          <Button
            onClick={handleDelete}
            variant="contained"
            color="error"
            disabled={formLoading}
          >
            {formLoading ? <CircularProgress size={20} /> : 'Elimina'}
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

export default ContentsPage;
