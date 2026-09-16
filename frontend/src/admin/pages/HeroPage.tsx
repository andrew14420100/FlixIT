// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Grid from '@mui/material/Grid';
import Chip from '@mui/material/Chip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import CardMedia from '@mui/material/CardMedia';
import CardContent from '@mui/material/CardContent';
import InputAdornment from '@mui/material/InputAdornment';
import Fade from '@mui/material/Fade';
import SaveIcon from '@mui/icons-material/Save';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SearchIcon from '@mui/icons-material/Search';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import StarIcon from '@mui/icons-material/Star';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { adminAPI } from '../services/api';
import { tmdbService, type TMDBImages } from '../services/tmdb';
import type { Content, HeroSettings, TMDBSearchResult } from '../types';

interface ContentOption extends Content {
  tmdbData?: TMDBSearchResult | null;
  images?: TMDBImages | null;
}

type SelectMode = 'catalog' | 'search';

const HeroPage: React.FC = () => {
  const [contents, setContents] = useState<ContentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Selection mode
  const [selectMode, setSelectMode] = useState<SelectMode>('catalog');
  const [tmdbSearchQuery, setTmdbSearchQuery] = useState('');
  const [tmdbSearchType, setTmdbSearchType] = useState<'movie' | 'tv'>('movie');
  const [tmdbResults, setTmdbResults] = useState<TMDBSearchResult[]>([]);
  const [tmdbSearching, setTmdbSearching] = useState(false);

  const [selectedContentId, setSelectedContentId] = useState<string>('');
  const [selectedType, setSelectedType] = useState<'movie' | 'tv'>('movie');
  const [customTitle, setCustomTitle] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customBackdrop, setCustomBackdrop] = useState('');
  const [seasonLabel, setSeasonLabel] = useState('');

  const [previewData, setPreviewData] = useState<TMDBSearchResult | null>(null);
  const [previewImages, setPreviewImages] = useState<TMDBImages | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const loadData = useCallback(async () => {
    try {
      // Load available contents
      const contentsData = await adminAPI.getContents({ available: true, limit: 100 });

      // Fetch TMDB details
      const contentsWithTMDB = await Promise.all(
        contentsData.items.map(async (content: Content) => {
          const [tmdbData, images] = await Promise.all([
            tmdbService.getDetails(content.tmdbId, content.type),
            tmdbService.getImages(content.tmdbId, content.type),
          ]);
          return { ...content, tmdbData, images };
        })
      );
      setContents(contentsWithTMDB);

      // Load current hero
      const heroData = await adminAPI.getHero();
      if (heroData && heroData.contentId) {
        setSelectedContentId(heroData.contentId);
        setCustomTitle(heroData.customTitle || '');
        setCustomDescription(heroData.customDescription || '');
        setCustomBackdrop(heroData.customBackdrop || '');
        setSeasonLabel(heroData.seasonLabel || '');
        
        // Find if it's from catalog
        const existingContent = contentsWithTMDB.find(
          (c) => String(c.tmdbId) === heroData.contentId
        );
        if (existingContent) {
          setSelectMode('catalog');
          setSelectedType(existingContent.type);
        } else {
          // Content was selected from TMDB search, switch to search mode
          setSelectMode('search');
          // Try to determine type from heroData or default to tv
          setSelectedType((heroData as any).mediaType || 'tv');
        }
      }
    } catch (error) {
      console.error('Errore caricamento dati:', error);
      showSnackbar('Errore nel caricamento', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update preview when selection changes
  useEffect(() => {
    const loadPreview = async () => {
      if (!selectedContentId) {
        setPreviewData(null);
        setPreviewImages(null);
        return;
      }

      // First check catalog
      const content = contents.find((c) => String(c.tmdbId) === selectedContentId);
      if (content?.tmdbData) {
        setPreviewData(content.tmdbData);
        setPreviewImages(content.images || null);
      } else {
        // Fetch from TMDB
        const [details, images] = await Promise.all([
          tmdbService.getDetails(parseInt(selectedContentId), selectedType),
          tmdbService.getImages(parseInt(selectedContentId), selectedType),
        ]);
        setPreviewData(details);
        setPreviewImages(images);
      }
    };
    loadPreview();
  }, [selectedContentId, selectedType, contents]);

  const showSnackbar = (message: string, severity: 'success' | 'error'): void => {
    setSnackbar({ open: true, message, severity });
  };

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

  const handleSelectFromSearch = (result: TMDBSearchResult): void => {
    setSelectedContentId(String(result.id));
    setSelectedType(tmdbSearchType);
  };

  const handleSave = async (): Promise<void> => {
    if (!selectedContentId) {
      showSnackbar('Seleziona un contenuto', 'error');
      return;
    }

    setSaving(true);
    try {
      await adminAPI.updateHero({
        contentId: selectedContentId,
        mediaType: selectedType,  // Include mediaType in the request
        customTitle: customTitle || null,
        customDescription: customDescription || null,
        customBackdrop: customBackdrop || null,
        seasonLabel: seasonLabel || null,
      });
      showSnackbar('Hero section aggiornata! Sarà visibile sul sito.', 'success');
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Errore nel salvataggio', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress sx={{ color: '#e50914' }} />
      </Box>
    );
  }

  const displayTitle = customTitle || previewData?.title || previewData?.name || '';
  const displayDescription = customDescription || previewData?.overview || '';
  const displayBackdrop = customBackdrop || tmdbService.getBackdropUrl(previewData?.backdrop_path);
  const displayLogo = previewImages?.logos?.[0]?.file_path 
    ? tmdbService.getLogoUrl(previewImages.logos[0].file_path, 'w500')
    : null;

  return (
    <Box data-testid="hero-page">
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: '#fff' }}>
          Hero Section
        </Typography>
        <Typography variant="body2" sx={{ color: 'grey.500', mt: 0.5 }}>
          Configura il contenuto in evidenza sulla homepage del sito
        </Typography>
      </Box>

      <Grid container spacing={4}>
        {/* Settings Panel */}
        <Grid item xs={12} lg={5}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              bgcolor: 'rgba(20, 20, 20, 0.8)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 3,
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3, color: '#fff' }}>
              Seleziona Contenuto
            </Typography>

            {/* Selection Mode Tabs */}
            <Tabs
              value={selectMode}
              onChange={(_, v) => setSelectMode(v)}
              sx={{
                mb: 3,
                '& .MuiTab-root': {
                  textTransform: 'none',
                  fontWeight: 600,
                  minHeight: 44,
                },
                '& .Mui-selected': { color: '#e50914 !important' },
                '& .MuiTabs-indicator': { bgcolor: '#e50914' },
              }}
            >
              <Tab value="catalog" label="Dal Catalogo" />
              <Tab value="search" label="Cerca su TMDB" />
            </Tabs>

            {selectMode === 'catalog' ? (
              <FormControl fullWidth sx={{ mb: 3 }}>
                <InputLabel>Seleziona dal Catalogo</InputLabel>
                <Select
                  value={selectedContentId}
                  label="Seleziona dal Catalogo"
                  onChange={(e) => {
                    setSelectedContentId(e.target.value);
                    const content = contents.find(c => String(c.tmdbId) === e.target.value);
                    if (content) setSelectedType(content.type);
                  }}
                  data-testid="hero-content-select"
                >
                  {contents.map((content) => (
                    <MenuItem key={content.tmdbId} value={String(content.tmdbId)}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        {content.type === 'movie' ? (
                          <MovieIcon sx={{ color: '#3b82f6', fontSize: 18 }} />
                        ) : (
                          <TvIcon sx={{ color: '#8b5cf6', fontSize: 18 }} />
                        )}
                        <span>{content.tmdbData?.title || content.tmdbData?.name}</span>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                  <Chip
                    icon={<MovieIcon sx={{ fontSize: 16 }} />}
                    label="Film"
                    onClick={() => setTmdbSearchType('movie')}
                    sx={{
                      bgcolor: tmdbSearchType === 'movie' ? '#e50914' : 'rgba(255,255,255,0.06)',
                      color: tmdbSearchType === 'movie' ? '#fff' : 'grey.400',
                      fontWeight: 600,
                      '& .MuiChip-icon': { color: 'inherit' },
                    }}
                  />
                  <Chip
                    icon={<TvIcon sx={{ fontSize: 16 }} />}
                    label="Serie TV"
                    onClick={() => setTmdbSearchType('tv')}
                    sx={{
                      bgcolor: tmdbSearchType === 'tv' ? '#e50914' : 'rgba(255,255,255,0.06)',
                      color: tmdbSearchType === 'tv' ? '#fff' : 'grey.400',
                      fontWeight: 600,
                      '& .MuiChip-icon': { color: 'inherit' },
                    }}
                  />
                </Box>
                <TextField
                  fullWidth
                  placeholder={`Cerca ${tmdbSearchType === 'movie' ? 'film' : 'serie TV'}...`}
                  value={tmdbSearchQuery}
                  onChange={(e) => setTmdbSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTmdbSearch()}
                  size="small"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ color: 'grey.500' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <Button
                          size="small"
                          onClick={handleTmdbSearch}
                          disabled={tmdbSearching}
                          sx={{ color: '#e50914', fontWeight: 600, textTransform: 'none' }}
                        >
                          {tmdbSearching ? <CircularProgress size={16} /> : 'Cerca'}
                        </Button>
                      </InputAdornment>
                    ),
                  }}
                />
                
                {/* Search Results */}
                {tmdbResults.length > 0 && (
                  <Box sx={{ mt: 2, maxHeight: 250, overflow: 'auto' }}>
                    {tmdbResults.slice(0, 6).map((result) => (
                      <Box
                        key={result.id}
                        onClick={() => handleSelectFromSearch(result)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 2,
                          p: 1.5,
                          borderRadius: 2,
                          cursor: 'pointer',
                          bgcolor: selectedContentId === String(result.id) ? 'rgba(229,9,20,0.15)' : 'transparent',
                          border: selectedContentId === String(result.id) ? '1px solid #e50914' : '1px solid transparent',
                          transition: 'all 0.2s',
                          '&:hover': {
                            bgcolor: 'rgba(255,255,255,0.05)',
                          },
                        }}
                      >
                        <Box
                          component="img"
                          src={tmdbService.getImageUrl(result.poster_path, 'w92')}
                          sx={{ width: 40, height: 60, borderRadius: 1, objectFit: 'cover' }}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ color: '#fff', fontWeight: 500, fontSize: 14 }} noWrap>
                            {result.title || result.name}
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography sx={{ color: 'grey.500', fontSize: 12 }}>
                              {result.release_date?.split('-')[0] || result.first_air_date?.split('-')[0]}
                            </Typography>
                            {result.vote_average > 0 && (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                <StarIcon sx={{ fontSize: 12, color: '#fbbf24' }} />
                                <Typography sx={{ fontSize: 11, color: 'grey.400' }}>
                                  {result.vote_average.toFixed(1)}
                                </Typography>
                              </Box>
                            )}
                          </Box>
                        </Box>
                        {selectedContentId === String(result.id) && (
                          <CheckCircleIcon sx={{ color: '#e50914' }} />
                        )}
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            )}

            {/* Custom Fields */}
            <Typography variant="subtitle2" sx={{ color: 'grey.400', mb: 2, fontWeight: 600 }}>
              Personalizzazioni (opzionali)
            </Typography>

            <TextField
              fullWidth
              label="Titolo Personalizzato"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder={previewData?.title || previewData?.name || ''}
              helperText="Lascia vuoto per usare il titolo originale"
              size="small"
              sx={{ mb: 2 }}
              inputProps={{ 'data-testid': 'hero-custom-title' }}
            />

            <TextField
              fullWidth
              multiline
              rows={3}
              label="Descrizione Personalizzata"
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="Lascia vuoto per la descrizione originale"
              size="small"
              sx={{ mb: 2 }}
              inputProps={{ 'data-testid': 'hero-custom-description' }}
            />

            <TextField
              fullWidth
              label="Etichetta (es: Stagione 3 disponibile)"
              value={seasonLabel}
              onChange={(e) => setSeasonLabel(e.target.value)}
              placeholder="Mostrata sotto il titolo"
              size="small"
              sx={{ mb: 3 }}
              inputProps={{ 'data-testid': 'hero-season-label' }}
            />

            <Button
              fullWidth
              variant="contained"
              startIcon={saving ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !selectedContentId}
              data-testid="hero-save-btn"
              sx={{
                py: 1.5,
                bgcolor: '#e50914',
                fontWeight: 600,
                textTransform: 'none',
                fontSize: 15,
                borderRadius: 2,
                '&:hover': { bgcolor: '#b20710' },
                '&:disabled': { bgcolor: 'rgba(229, 9, 20, 0.4)' },
              }}
            >
              {saving ? 'Salvataggio...' : 'Pubblica sul Sito'}
            </Button>
          </Paper>
        </Grid>

        {/* Preview Panel */}
        <Grid item xs={12} lg={7}>
          <Paper
            elevation={0}
            sx={{
              bgcolor: 'rgba(20, 20, 20, 0.8)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ p: 3, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <Typography variant="h6" sx={{ fontWeight: 600, color: '#fff' }}>
                Anteprima Hero
              </Typography>
              <Typography variant="body2" sx={{ color: 'grey.500' }}>
                Come apparirà sulla homepage del sito
              </Typography>
            </Box>

            {selectedContentId && previewData ? (
              <Fade in timeout={400}>
                <Box sx={{ position: 'relative' }}>
                  {/* Backdrop */}
                  <Box
                    sx={{
                      position: 'relative',
                      width: '100%',
                      paddingTop: '56.25%',
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      component="img"
                      src={displayBackdrop}
                      alt=""
                      sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                    {/* Gradient Overlay */}
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: `
                          linear-gradient(to right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 40%, transparent 70%),
                          linear-gradient(to top, rgba(0,0,0,0.95) 0%, transparent 50%)
                        `,
                      }}
                    />
                    
                    {/* Content Overlay */}
                    <Box
                      sx={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        p: 4,
                      }}
                    >
                      {/* Logo or Title */}
                      {displayLogo ? (
                        <Box
                          component="img"
                          src={displayLogo}
                          alt={displayTitle}
                          sx={{
                            maxWidth: 350,
                            maxHeight: 120,
                            mb: 2,
                            filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.5))',
                          }}
                        />
                      ) : (
                        <Typography
                          variant="h3"
                          sx={{
                            fontWeight: 800,
                            color: '#fff',
                            mb: 2,
                            textShadow: '0 4px 20px rgba(0,0,0,0.5)',
                            fontSize: { xs: 28, md: 36 },
                          }}
                        >
                          {displayTitle}
                        </Typography>
                      )}

                      {/* Season Label */}
                      {seasonLabel && (
                        <Chip
                          label={seasonLabel}
                          sx={{
                            mb: 2,
                            bgcolor: 'rgba(229,9,20,0.9)',
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: 13,
                          }}
                        />
                      )}

                      {/* Description */}
                      <Typography
                        sx={{
                          color: 'grey.300',
                          maxWidth: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          lineHeight: 1.6,
                          fontSize: 14,
                          textShadow: '0 2px 10px rgba(0,0,0,0.5)',
                          mb: 3,
                        }}
                      >
                        {displayDescription}
                      </Typography>

                      {/* Buttons Preview */}
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <Button
                          variant="contained"
                          startIcon={<PlayArrowIcon />}
                          sx={{
                            bgcolor: '#fff',
                            color: '#000',
                            fontWeight: 700,
                            px: 3,
                            py: 1,
                            textTransform: 'none',
                            '&:hover': { bgcolor: 'rgba(255,255,255,0.8)' },
                          }}
                        >
                          Riproduci
                        </Button>
                        <Button
                          variant="contained"
                          startIcon={<InfoOutlinedIcon />}
                          sx={{
                            bgcolor: 'rgba(109, 109, 110, 0.7)',
                            color: '#fff',
                            fontWeight: 600,
                            px: 3,
                            py: 1,
                            textTransform: 'none',
                            '&:hover': { bgcolor: 'rgba(109, 109, 110, 0.5)' },
                          }}
                        >
                          Altre Info
                        </Button>
                      </Box>
                    </Box>
                  </Box>
                </Box>
              </Fade>
            ) : (
              <Box
                sx={{
                  p: 8,
                  textAlign: 'center',
                  bgcolor: 'rgba(0,0,0,0.4)',
                }}
              >
                <MovieIcon sx={{ fontSize: 64, color: 'grey.700', mb: 2 }} />
                <Typography sx={{ color: 'grey.500' }}>
                  Seleziona un contenuto per visualizzare l'anteprima
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

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

export default HeroPage;
