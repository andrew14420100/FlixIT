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
import Tooltip from '@mui/material/Tooltip';
import Fade from '@mui/material/Fade';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import MenuIcon from '@mui/icons-material/Menu';
import LinkIcon from '@mui/icons-material/Link';
import { adminAPI } from '../services/api';

interface MenuItem {
  id: string;
  name: string;
  path: string;
  order: number;
  active: boolean;
}

const MenuPage: React.FC = () => {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<MenuItem | null>(null);
  
  const [formName, setFormName] = useState('');
  const [formPath, setFormPath] = useState('');

  const loadMenuItems = useCallback(async () => {
    try {
      const data = await adminAPI.getMenuItems();
      setMenuItems(data.items.sort((a: MenuItem, b: MenuItem) => a.order - b.order));
    } catch (error) {
      showSnackbar('Errore nel caricamento', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMenuItems();
  }, [loadMenuItems]);

  const showSnackbar = (message: string, severity: 'success' | 'error'): void => {
    setSnackbar({ open: true, message, severity });
  };

  const handleToggle = async (item: MenuItem): Promise<void> => {
    setUpdating(item.id);
    try {
      await adminAPI.updateMenuItem(item.id, { active: !item.active });
      setMenuItems(
        menuItems.map((m) => (m.id === item.id ? { ...m, active: !m.active } : m))
      );
      showSnackbar(`"${item.name}" ${!item.active ? 'attivata' : 'disattivata'}`, 'success');
    } catch {
      showSnackbar("Errore nell'aggiornamento", 'error');
    } finally {
      setUpdating(null);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down'): Promise<void> => {
    const newItems = [...menuItems];
    const newIndex = direction === 'up' ? index - 1 : index + 1;

    if (newIndex < 0 || newIndex >= menuItems.length) return;

    const itemId = newItems[index].id;
    setUpdating(itemId);

    [newItems[index], newItems[newIndex]] = [newItems[newIndex], newItems[index]];
    const reorderedItems = newItems.map((m, i) => ({ ...m, order: i + 1 }));
    setMenuItems(reorderedItems);

    try {
      await adminAPI.reorderMenuItems(reorderedItems.map((m) => ({ id: m.id, order: m.order })));
      showSnackbar('Ordine aggiornato', 'success');
    } catch {
      loadMenuItems();
      showSnackbar('Errore nel riordinamento', 'error');
    } finally {
      setUpdating(null);
    }
  };

  const openCreateDialog = () => {
    setEditingItem(null);
    setFormName('');
    setFormPath('');
    setDialogOpen(true);
  };

  const openEditDialog = (item: MenuItem) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormPath(item.path);
    setDialogOpen(true);
  };

  const handleSaveItem = async () => {
    if (!formName.trim() || !formPath.trim()) {
      showSnackbar('Compila tutti i campi', 'error');
      return;
    }

    setUpdating('saving');
    try {
      if (editingItem) {
        await adminAPI.updateMenuItem(editingItem.id, { name: formName, path: formPath });
        showSnackbar('Voce aggiornata!', 'success');
      } else {
        await adminAPI.createMenuItem({ 
          name: formName, 
          path: formPath,
          order: menuItems.length + 1,
          active: true
        });
        showSnackbar('Voce creata!', 'success');
      }
      setDialogOpen(false);
      loadMenuItems();
    } catch (err: any) {
      showSnackbar(err.message || 'Errore nel salvataggio', 'error');
    } finally {
      setUpdating(null);
    }
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete) return;
    
    setUpdating('deleting');
    try {
      await adminAPI.deleteMenuItem(itemToDelete.id);
      showSnackbar('Voce eliminata', 'success');
      setDeleteDialogOpen(false);
      loadMenuItems();
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

  return (
    <Box data-testid="menu-page">
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: '#fff' }}>
            Gestione Menu Header
          </Typography>
          <Typography variant="body2" sx={{ color: 'grey.500', mt: 0.5 }}>
            Gestisci le voci del menu di navigazione principale
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openCreateDialog}
          sx={{ bgcolor: '#e50914', '&:hover': { bgcolor: '#b20710' }, fontWeight: 600 }}
          data-testid="add-menu-item-btn"
        >
          Nuova Voce
        </Button>
      </Box>

      <Paper elevation={0} sx={{ bgcolor: 'rgba(20, 20, 20, 0.8)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr auto', alignItems: 'center', gap: 2, px: 2, py: 1.5, bgcolor: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Typography sx={{ color: 'grey.600', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>#</Typography>
          <Typography sx={{ color: 'grey.600', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Nome</Typography>
          <Typography sx={{ color: 'grey.600', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Percorso</Typography>
          <Typography sx={{ color: 'grey.600', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', textAlign: 'right' }}>Azioni</Typography>
        </Box>

        {menuItems.map((item, index) => (
          <Fade in key={item.id} timeout={200} style={{ transitionDelay: `${index * 30}ms` }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr auto', alignItems: 'center', gap: 2, px: 2, py: 2, borderBottom: index < menuItems.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', bgcolor: item.active ? 'transparent' : 'rgba(0,0,0,0.2)', opacity: item.active ? 1 : 0.6, transition: 'all 0.3s ease', '&:hover': { bgcolor: item.active ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.3)' } }}>
              <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: item.active ? 'rgba(229,9,20,0.15)' : 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography sx={{ color: item.active ? '#e50914' : 'grey.600', fontWeight: 700, fontSize: 13 }}>{index + 1}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <MenuIcon sx={{ color: 'grey.500', fontSize: 18 }} />
                <Typography sx={{ color: item.active ? '#fff' : 'grey.500', fontWeight: 600 }}>{item.name}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LinkIcon sx={{ color: 'grey.600', fontSize: 16 }} />
                <Typography sx={{ color: 'grey.400', fontSize: 14, fontFamily: 'monospace' }}>{item.path}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Tooltip title="Modifica"><IconButton size="small" onClick={() => openEditDialog(item)} sx={{ color: 'grey.500', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' } }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Elimina"><IconButton size="small" onClick={() => { setItemToDelete(item); setDeleteDialogOpen(true); }} sx={{ color: 'grey.500', '&:hover': { color: '#e50914', bgcolor: 'rgba(229,9,20,0.1)' } }}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                <Box sx={{ display: 'flex', flexDirection: 'column', bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1.5, overflow: 'hidden', ml: 1 }}>
                  <Tooltip title="Sposta su" placement="left"><span><IconButton size="small" onClick={() => handleMove(index, 'up')} disabled={index === 0} sx={{ borderRadius: 0, color: 'grey.500', py: 0.5, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' }, '&.Mui-disabled': { color: 'grey.800' } }}><KeyboardArrowUpIcon fontSize="small" /></IconButton></span></Tooltip>
                  <Tooltip title="Sposta giù" placement="left"><span><IconButton size="small" onClick={() => handleMove(index, 'down')} disabled={index === menuItems.length - 1} sx={{ borderRadius: 0, color: 'grey.500', py: 0.5, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' }, '&.Mui-disabled': { color: 'grey.800' } }}><KeyboardArrowDownIcon fontSize="small" /></IconButton></span></Tooltip>
                </Box>
                <Tooltip title={item.active ? 'Nascondi' : 'Mostra'}>
                  <Switch checked={item.active} onChange={() => handleToggle(item)} sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#22c55e' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#22c55e' } }} />
                </Tooltip>
              </Box>
            </Box>
          </Fade>
        ))}
        {menuItems.length === 0 && (<Box sx={{ py: 6, textAlign: 'center' }}><Typography sx={{ color: 'grey.500' }}>Nessuna voce di menu.</Typography></Box>)}
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} PaperProps={{ sx: { bgcolor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3, minWidth: 400 } }}>
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>{editingItem ? 'Modifica Voce Menu' : 'Nuova Voce Menu'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
            <TextField label="Nome" value={formName} onChange={(e) => setFormName(e.target.value)} fullWidth placeholder="Es: Serie TV" sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#2a2a2a' } }} />
            <TextField label="Percorso (URL)" value={formPath} onChange={(e) => setFormPath(e.target.value)} fullWidth placeholder="Es: /browse/genre/tv" sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#2a2a2a' } }} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: 'grey.400' }}>Annulla</Button>
          <Button onClick={handleSaveItem} variant="contained" disabled={updating === 'saving'} sx={{ bgcolor: '#e50914', '&:hover': { bgcolor: '#b20710' } }}>{updating === 'saving' ? <CircularProgress size={20} /> : 'Salva'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} PaperProps={{ sx: { bgcolor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3 } }}>
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>Conferma Eliminazione</DialogTitle>
        <DialogContent><Typography sx={{ color: 'grey.300' }}>Sei sicuro di voler eliminare "{itemToDelete?.name}"?</Typography></DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} sx={{ color: 'grey.400' }}>Annulla</Button>
          <Button onClick={handleDeleteItem} variant="contained" disabled={updating === 'deleting'} sx={{ bgcolor: '#e50914', '&:hover': { bgcolor: '#b20710' } }}>{updating === 'deleting' ? <CircularProgress size={20} /> : 'Elimina'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snackbar.severity} variant="filled" sx={{ borderRadius: 2 }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
};

export default MenuPage;
