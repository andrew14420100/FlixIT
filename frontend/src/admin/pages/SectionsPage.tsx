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
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Fade from '@mui/material/Fade';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { adminAPI } from '../services/api';
import type { Section } from '../types';

const API_TYPES = [
  { value: 'popular', label: 'Popolari' },
  { value: 'top_rated', label: 'Più Votati' },
  { value: 'now_playing', label: 'Al Cinema (Solo Film)' },
  { value: 'upcoming', label: 'Prossimamente (Solo Film)' },
  { value: 'airing_today', label: 'In Onda Oggi (Solo TV)' },
  { value: 'on_the_air', label: 'In Onda Questa Settimana (Solo TV)' },
];

const SectionsPage: React.FC = () => {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });
  
  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sectionToDelete, setSectionToDelete] = useState<Section | null>(null);
  
  // Form states
  const [formName, setFormName] = useState('');
  const [formApiString, setFormApiString] = useState('popular');
  const [formMediaType, setFormMediaType] = useState<'movie' | 'tv'>('movie');
  const [availableSections, setAvailableSections] = useState<any[]>([]);
  const [selectedPredefined, setSelectedPredefined] = useState('');

  const loadSections = useCallback(async () => {
    try {
      const data = await adminAPI.getSections();
      setSections(data.items.sort((a: Section, b: Section) => a.order - b.order));
    } catch (error) {
      console.error('Errore caricamento sezioni:', error);
      showSnackbar('Errore nel caricamento', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAvailable = useCallback(async () => {
    try {
      const data = await adminAPI.getAvailableSections();
      setAvailableSections(data.available || []);
    } catch (e) {
      console.error('Error loading available sections', e);
    }
  }, []);

  useEffect(() => {
    loadSections();
    loadAvailable();
  }, [loadSections, loadAvailable]);

  const showSnackbar = (message: string, severity: 'success' | 'error'): void => {
    setSnackbar({ open: true, message, severity });
  };

  const handleToggle = async (section: Section): Promise<void> => {
    setUpdating(section.name);
    try {
      await adminAPI.updateSection(section.name, { active: !section.active });
      setSections(
        sections.map((s) => (s.name === section.name ? { ...s, active: !s.active } : s))
      );
      showSnackbar(
        `"${section.name}" ${!section.active ? 'attivata' : 'disattivata'} sul sito`,
        'success'
      );
    } catch {
      showSnackbar("Errore nell'aggiornamento", 'error');
    } finally {
      setUpdating(null);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down'): Promise<void> => {
    const newSections = [...sections];
    const newIndex = direction === 'up' ? index - 1 : index + 1;

    if (newIndex < 0 || newIndex >= sections.length) return;

    const sectionName = newSections[index].name;
    setUpdating(sectionName);

    [newSections[index], newSections[newIndex]] = [newSections[newIndex], newSections[index]];
    const reorderedSections = newSections.map((s, i) => ({ ...s, order: i + 1 }));
    setSections(reorderedSections);

    try {
      await adminAPI.reorderSections(
        reorderedSections.map((s) => ({ name: s.name, order: s.order }))
      );
      showSnackbar('Ordine aggiornato sul sito', 'success');
    } catch {
      loadSections();
      showSnackbar('Errore nel riordinamento', 'error');
    } finally {
      setUpdating(null);
    }
  };

  const openCreateDialog = () => {
    setEditingSection(null);
    setSelectedPredefined('');
    setFormName('');
    setFormApiString('popular');
    setFormMediaType('movie');
    loadAvailable();
    setDialogOpen(true);
  };

  const openEditDialog = (section: Section) => {
    setEditingSection(section);
    setFormName(section.name);
    setFormApiString(section.apiString);
    setFormMediaType(section.mediaType);
    setDialogOpen(true);
  };

  const handleSaveSection = async () => {
    setUpdating('saving');
    try {
      if (editingSection) {
        await adminAPI.updateSection(editingSection.name, {
          name: formName,
          section_type: formApiString,
          media_type: formMediaType,
        });
        showSnackbar('Sezione aggiornata!', 'success');
      } else if (selectedPredefined) {
        await adminAPI.addPredefinedSection(selectedPredefined);
        showSnackbar(`"${selectedPredefined}" aggiunta alla homepage!`, 'success');
      } else {
        showSnackbar('Seleziona una sezione', 'error');
        setUpdating(null);
        return;
      }
      setDialogOpen(false);
      loadSections();
      loadAvailable();
    } catch (err: any) {
      showSnackbar(err.message || 'Errore nel salvataggio', 'error');
    } finally {
      setUpdating(null);
    }
  };

  const handleDeleteSection = async () => {
    if (!sectionToDelete) return;
    
    setUpdating('deleting');
    try {
      await adminAPI.deleteSection(sectionToDelete.name);
      showSnackbar('Sezione eliminata', 'success');
      setDeleteDialogOpen(false);
      loadSections();
    } catch {
      showSnackbar('Errore nell\'eliminazione', 'error');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress sx={{ color: '#e50914' }} />
      </Box>
    );
  }

  const activeSections = sections.filter((s) => s.active);
  const inactiveSections = sections.filter((s) => !s.active);

  return (
    <Box data-testid="sections-page">
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: '#fff' }}>
            Gestione Sezioni Homepage
          </Typography>
          <Typography variant="body2" sx={{ color: 'grey.500', mt: 0.5 }}>
            Crea, modifica, riordina e gestisci le sezioni visibili sulla homepage
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openCreateDialog}
          sx={{
            bgcolor: '#e50914',
            '&:hover': { bgcolor: '#b20710' },
            fontWeight: 600,
          }}
          data-testid="add-section-btn"
        >
          Nuova Sezione
        </Button>
      </Box>

      {/* Stats */}
      <Box sx={{ display: 'flex', gap: 2, mb: 4, flexWrap: 'wrap' }}>
        <Paper
          sx={{
            px: 3,
            py: 2,
            bgcolor: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.2)',
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <VisibilityIcon sx={{ color: '#22c55e' }} />
          <Box>
            <Typography sx={{ color: '#22c55e', fontWeight: 700, fontSize: 20 }}>
              {activeSections.length}
            </Typography>
            <Typography sx={{ color: 'grey.400', fontSize: 12 }}>Sezioni Attive</Typography>
          </Box>
        </Paper>
        <Paper
          sx={{
            px: 3,
            py: 2,
            bgcolor: 'rgba(107,114,128,0.1)',
            border: '1px solid rgba(107,114,128,0.2)',
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <VisibilityOffIcon sx={{ color: 'grey.500' }} />
          <Box>
            <Typography sx={{ color: 'grey.400', fontWeight: 700, fontSize: 20 }}>
              {inactiveSections.length}
            </Typography>
            <Typography sx={{ color: 'grey.500', fontSize: 12 }}>Sezioni Nascoste</Typography>
          </Box>
        </Paper>
      </Box>

      {/* Sections List */}
      <Paper
        elevation={0}
        sx={{
          bgcolor: 'rgba(20, 20, 20, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        {/* Header Row */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '40px 44px 1fr auto',
            alignItems: 'center',
            gap: 2,
            px: 2,
            py: 1.5,
            bgcolor: 'rgba(0,0,0,0.3)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <Typography sx={{ color: 'grey.600', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
            #
          </Typography>
          <Typography sx={{ color: 'grey.600', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
            Tipo
          </Typography>
          <Typography sx={{ color: 'grey.600', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
            Sezione
          </Typography>
          <Typography sx={{ color: 'grey.600', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', textAlign: 'right' }}>
            Azioni
          </Typography>
        </Box>

        {/* Section Items */}
        {sections.map((section, index) => {
          const isUpdating = updating === section.name;
          
          return (
            <Fade in key={section.name} timeout={200} style={{ transitionDelay: `${index * 30}ms` }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '40px 44px 1fr auto',
                  alignItems: 'center',
                  gap: 2,
                  px: 2,
                  py: 2,
                  borderBottom: index < sections.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  bgcolor: section.active ? 'transparent' : 'rgba(0,0,0,0.2)',
                  opacity: section.active ? 1 : 0.6,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    bgcolor: section.active ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.3)',
                  },
                }}
              >
                {/* Order Number */}
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    bgcolor: section.active ? 'rgba(229,9,20,0.15)' : 'rgba(255,255,255,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography
                    sx={{
                      color: section.active ? '#e50914' : 'grey.600',
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    {index + 1}
                  </Typography>
                </Box>

                {/* Type Icon */}
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: 2,
                    bgcolor: section.mediaType === 'movie' ? 'rgba(59,130,246,0.15)' : 'rgba(139,92,246,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {section.mediaType === 'movie' ? (
                    <MovieIcon sx={{ color: '#3b82f6', fontSize: 20 }} />
                  ) : (
                    <TvIcon sx={{ color: '#8b5cf6', fontSize: 20 }} />
                  )}
                </Box>

                {/* Section Info */}
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    <Typography
                      sx={{
                        color: section.active ? '#fff' : 'grey.500',
                        fontWeight: 600,
                        fontSize: 15,
                      }}
                    >
                      {section.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={section.mediaType === 'movie' ? 'Film' : 'Serie TV'}
                      sx={{
                        height: 20,
                        fontSize: 10,
                        fontWeight: 600,
                        bgcolor: section.mediaType === 'movie' ? 'rgba(59,130,246,0.15)' : 'rgba(139,92,246,0.15)',
                        color: section.mediaType === 'movie' ? '#3b82f6' : '#8b5cf6',
                      }}
                    />
                    {section.active && (
                      <Chip
                        size="small"
                        icon={<VisibilityIcon sx={{ fontSize: '12px !important' }} />}
                        label="Visibile"
                        sx={{
                          height: 20,
                          fontSize: 10,
                          fontWeight: 600,
                          bgcolor: 'rgba(34,197,94,0.15)',
                          color: '#22c55e',
                          '& .MuiChip-icon': { color: '#22c55e' },
                        }}
                      />
                    )}
                  </Box>
                  <Typography sx={{ color: 'grey.600', fontSize: 12, mt: 0.5 }}>
                    API: <code style={{ color: 'grey.500' }}>{section.apiString}</code>
                  </Typography>
                </Box>

                {/* Actions */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {/* Edit Button */}
                  <Tooltip title="Modifica">
                    <IconButton
                      size="small"
                      onClick={() => openEditDialog(section)}
                      sx={{ color: 'grey.500', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' } }}
                      data-testid={`edit-${section.name}`}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  {/* Delete Button */}
                  <Tooltip title="Elimina">
                    <IconButton
                      size="small"
                      onClick={() => { setSectionToDelete(section); setDeleteDialogOpen(true); }}
                      sx={{ color: 'grey.500', '&:hover': { color: '#e50914', bgcolor: 'rgba(229,9,20,0.1)' } }}
                      data-testid={`delete-${section.name}`}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  {/* Move Buttons */}
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      bgcolor: 'rgba(255,255,255,0.03)',
                      borderRadius: 1.5,
                      overflow: 'hidden',
                      ml: 1,
                    }}
                  >
                    <Tooltip title="Sposta su" placement="left">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => handleMove(index, 'up')}
                          disabled={index === 0 || isUpdating}
                          sx={{
                            borderRadius: 0,
                            color: 'grey.500',
                            py: 0.5,
                            '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' },
                            '&.Mui-disabled': { color: 'grey.800' },
                          }}
                          data-testid={`move-up-${section.name}`}
                        >
                          <KeyboardArrowUpIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Sposta giù" placement="left">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => handleMove(index, 'down')}
                          disabled={index === sections.length - 1 || isUpdating}
                          sx={{
                            borderRadius: 0,
                            color: 'grey.500',
                            py: 0.5,
                            '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' },
                            '&.Mui-disabled': { color: 'grey.800' },
                          }}
                          data-testid={`move-down-${section.name}`}
                        >
                          <KeyboardArrowDownIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>

                  {/* Toggle Switch */}
                  <Tooltip title={section.active ? 'Nascondi sul sito' : 'Mostra sul sito'}>
                    <Box sx={{ position: 'relative' }}>
                      <Switch
                        checked={section.active}
                        onChange={() => handleToggle(section)}
                        disabled={isUpdating}
                        data-testid={`toggle-${section.name}`}
                        sx={{
                          '& .MuiSwitch-switchBase.Mui-checked': { color: '#22c55e' },
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                            bgcolor: '#22c55e',
                          },
                        }}
                      />
                      {isUpdating && (
                        <CircularProgress
                          size={20}
                          sx={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            marginTop: '-10px',
                            marginLeft: '-10px',
                            color: '#e50914',
                          }}
                        />
                      )}
                    </Box>
                  </Tooltip>
                </Box>
              </Box>
            </Fade>
          );
        })}

        {sections.length === 0 && (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography sx={{ color: 'grey.500' }}>
              Nessuna sezione configurata. Clicca "Nuova Sezione" per iniziare.
            </Typography>
          </Box>
        )}
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
            Sincronizzazione in tempo reale
          </Typography>
          <Typography variant="body2" sx={{ color: 'grey.400' }}>
            Le modifiche all'ordine e alla visibilità delle sezioni vengono applicate immediatamente
            sulla homepage del sito principale. I visitatori vedranno le modifiche al prossimo refresh.
          </Typography>
        </Alert>
      </Box>

      {/* Create/Edit Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={() => setDialogOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 3,
            minWidth: 400,
          }
        }}
      >
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>
          {editingSection ? 'Modifica Sezione' : 'Nuova Sezione'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
            {editingSection ? (
              <>
                <TextField
                  label="Nome Sezione"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  fullWidth
                  sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#2a2a2a' } }}
                />
                <FormControl fullWidth>
                  <InputLabel>Tipo di Contenuto</InputLabel>
                  <Select value={formMediaType} label="Tipo di Contenuto"
                    onChange={(e) => setFormMediaType(e.target.value as 'movie' | 'tv')}
                    sx={{ bgcolor: '#2a2a2a' }}>
                    <MenuItem value="movie">Film</MenuItem>
                    <MenuItem value="tv">Serie TV</MenuItem>
                  </Select>
                </FormControl>
              </>
            ) : (
              <FormControl fullWidth>
                <InputLabel>Seleziona Sezione</InputLabel>
                <Select
                  value={selectedPredefined}
                  label="Seleziona Sezione"
                  onChange={(e) => setSelectedPredefined(e.target.value)}
                  sx={{ bgcolor: '#2a2a2a' }}
                  data-testid="predefined-section-select"
                >
                  {availableSections.map((s) => (
                    <MenuItem key={s.name} value={s.name}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Chip size="small" label={s.media_type === 'tv' ? 'TV' : s.media_type === 'mixed' ? 'Mix' : 'Film'}
                          sx={{ height: 18, fontSize: 9, fontWeight: 700,
                            bgcolor: s.media_type === 'tv' ? 'rgba(139,92,246,0.2)' : s.media_type === 'mixed' ? 'rgba(234,179,8,0.2)' : 'rgba(59,130,246,0.2)',
                            color: s.media_type === 'tv' ? '#8b5cf6' : s.media_type === 'mixed' ? '#eab308' : '#3b82f6' }} />
                        <Typography sx={{ fontSize: 14 }}>{s.name}</Typography>
                        <Typography sx={{ fontSize: 11, color: 'grey.500', ml: 'auto' }}>{s.description}</Typography>
                      </Box>
                    </MenuItem>
                  ))}
                  {availableSections.length === 0 && (
                    <MenuItem disabled>
                      <Typography sx={{ color: 'grey.500', fontSize: 13 }}>
                        Tutte le sezioni sono già state aggiunte
                      </Typography>
                    </MenuItem>
                  )}
                </Select>
              </FormControl>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: 'grey.400' }}>
            Annulla
          </Button>
          <Button 
            onClick={handleSaveSection}
            variant="contained"
            disabled={updating === 'saving'}
            sx={{ bgcolor: '#e50914', '&:hover': { bgcolor: '#b20710' } }}
          >
            {updating === 'saving' ? <CircularProgress size={20} /> : 'Salva'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog 
        open={deleteDialogOpen} 
        onClose={() => setDeleteDialogOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 3,
          }
        }}
      >
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>
          Conferma Eliminazione
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'grey.300' }}>
            Sei sicuro di voler eliminare la sezione "{sectionToDelete?.name}"?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} sx={{ color: 'grey.400' }}>
            Annulla
          </Button>
          <Button 
            onClick={handleDeleteSection}
            variant="contained"
            disabled={updating === 'deleting'}
            sx={{ bgcolor: '#e50914', '&:hover': { bgcolor: '#b20710' } }}
          >
            {updating === 'deleting' ? <CircularProgress size={20} /> : 'Elimina'}
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

export default SectionsPage;
