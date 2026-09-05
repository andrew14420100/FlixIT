import React, { useEffect, useState } from 'react';
import { useAdminStore } from '../../store/adminStore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { toast } from 'sonner';
import { 
  Plus, 
  GripVertical, 
  Eye, 
  EyeOff, 
  Trash2, 
  Edit2,
  Layers,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

const sectionTypes = [
  { value: 'trending', label: 'Trending' },
  { value: 'popular', label: 'Popolari' },
  { value: 'top_rated', label: 'Più Votati' },
  { value: 'now_playing', label: 'Al Cinema' },
  { value: 'upcoming', label: 'Prossimamente' },
  { value: 'airing_today', label: 'In Onda Oggi' },
  { value: 'on_the_air', label: 'In Onda' },
];

const mediaTypes = [
  { value: 'all', label: 'Tutti' },
  { value: 'movie', label: 'Film' },
  { value: 'tv', label: 'Serie TV' },
];

export default function AdminSections() {
  const { 
    sections, 
    fetchSections, 
    createSection, 
    updateSection, 
    deleteSection,
    reorderSections 
  } = useAdminStore();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSection, setEditingSection] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sectionToDelete, setSectionToDelete] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    section_type: 'popular',
    media_type: 'movie',
    visible: true,
    order: 0
  });

  useEffect(() => {
    fetchSections();
  }, [fetchSections]);

  const handleOpenDialog = (section = null) => {
    if (section) {
      setEditingSection(section);
      setFormData({
        name: section.name,
        section_type: section.section_type,
        media_type: section.media_type,
        visible: section.visible,
        order: section.order
      });
    } else {
      setEditingSection(null);
      setFormData({
        name: '',
        section_type: 'popular',
        media_type: 'movie',
        visible: true,
        order: sections.length
      });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Inserisci un nome per la sezione');
      return;
    }

    let result;
    if (editingSection) {
      result = await updateSection(editingSection.id, formData);
    } else {
      result = await createSection(formData);
    }

    if (result.success) {
      toast.success(editingSection ? 'Sezione aggiornata' : 'Sezione creata');
      setDialogOpen(false);
    } else {
      toast.error(result.error || 'Errore');
    }
  };

  const handleToggleVisibility = async (section) => {
    const result = await updateSection(section.id, { visible: !section.visible });
    if (result.success) {
      toast.success(`Sezione ${section.visible ? 'nascosta' : 'visibile'}`);
    }
  };

  const handleDelete = async () => {
    if (!sectionToDelete) return;
    const result = await deleteSection(sectionToDelete.id);
    if (result.success) {
      toast.success('Sezione eliminata');
    }
    setDeleteDialogOpen(false);
    setSectionToDelete(null);
  };

  const handleMoveUp = async (index) => {
    if (index === 0) return;
    const newSections = [...sections];
    [newSections[index - 1], newSections[index]] = [newSections[index], newSections[index - 1]];
    
    const orders = newSections.map((s, i) => ({ id: s.id, order: i }));
    const result = await reorderSections(orders);
    if (result.success) {
      toast.success('Ordine aggiornato');
    }
  };

  const handleMoveDown = async (index) => {
    if (index === sections.length - 1) return;
    const newSections = [...sections];
    [newSections[index], newSections[index + 1]] = [newSections[index + 1], newSections[index]];
    
    const orders = newSections.map((s, i) => ({ id: s.id, order: i }));
    const result = await reorderSections(orders);
    if (result.success) {
      toast.success('Ordine aggiornato');
    }
  };

  const getMediaTypeLabel = (type) => {
    const found = mediaTypes.find(t => t.value === type);
    return found ? found.label : type;
  };

  const getSectionTypeLabel = (type) => {
    const found = sectionTypes.find(t => t.value === type);
    return found ? found.label : type;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300" data-testid="admin-sections-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'Unbounded, sans-serif' }}>
            Sezioni Homepage
          </h1>
          <p className="text-zinc-400 mt-1">Gestisci le sezioni visualizzate nella homepage</p>
        </div>
        
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              onClick={() => handleOpenDialog()}
              className="bg-[#E50914] hover:bg-[#B20710] shadow-lg shadow-red-900/30"
              data-testid="add-section-btn"
            >
              <Plus size={18} className="mr-2" />
              Nuova Sezione
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-zinc-900 border-zinc-800">
            <DialogHeader>
              <DialogTitle>
                {editingSection ? 'Modifica Sezione' : 'Nuova Sezione'}
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome Sezione</Label>
                <Input
                  placeholder="Es: Film Popolari"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="bg-zinc-800 border-zinc-700"
                  data-testid="section-name-input"
                />
              </div>

              <div className="space-y-2">
                <Label>Tipo Sezione</Label>
                <Select 
                  value={formData.section_type} 
                  onValueChange={(v) => setFormData(prev => ({ ...prev, section_type: v }))}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {sectionTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Tipo Media</Label>
                <Select 
                  value={formData.media_type} 
                  onValueChange={(v) => setFormData(prev => ({ ...prev, media_type: v }))}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {mediaTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <Label>Visibile</Label>
                <Switch
                  checked={formData.visible}
                  onCheckedChange={(v) => setFormData(prev => ({ ...prev, visible: v }))}
                  data-testid="section-visible-switch"
                />
              </div>

              <Button 
                onClick={handleSave}
                className="w-full bg-[#E50914] hover:bg-[#B20710]"
                data-testid="save-section-btn"
              >
                {editingSection ? 'Salva Modifiche' : 'Crea Sezione'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Sections List */}
      <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center gap-2">
          <Layers size={18} className="text-zinc-500" />
          <span className="text-zinc-400">
            {sections.length} sezioni • Trascina per riordinare
          </span>
        </div>

        <div className="divide-y divide-white/5">
          {sections.map((section, index) => (
            <div 
              key={section.id}
              className={`flex items-center gap-4 p-4 hover:bg-white/5 transition-colors ${
                !section.visible ? 'opacity-50' : ''
              }`}
              data-testid={`section-item-${section.id}`}
            >
              {/* Drag Handle */}
              <div className="text-zinc-600 cursor-grab">
                <GripVertical size={20} />
              </div>

              {/* Order Number */}
              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-medium">
                {index + 1}
              </div>

              {/* Section Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{section.name}</p>
                <p className="text-zinc-500 text-sm">
                  {getSectionTypeLabel(section.section_type)} • {getMediaTypeLabel(section.media_type)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {/* Move Up/Down */}
                <button
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                  className="p-2 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Sposta su"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  onClick={() => handleMoveDown(index)}
                  disabled={index === sections.length - 1}
                  className="p-2 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Sposta giù"
                >
                  <ArrowDown size={16} />
                </button>

                {/* Toggle Visibility */}
                <button
                  onClick={() => handleToggleVisibility(section)}
                  className={`p-2 rounded transition-colors ${
                    section.visible 
                      ? 'text-green-400 hover:bg-green-500/20' 
                      : 'text-zinc-500 hover:bg-zinc-500/20'
                  }`}
                  title={section.visible ? 'Nascondi' : 'Mostra'}
                  data-testid={`toggle-section-${section.id}`}
                >
                  {section.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>

                {/* Edit */}
                <button
                  onClick={() => handleOpenDialog(section)}
                  className="p-2 rounded text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="Modifica"
                >
                  <Edit2 size={16} />
                </button>

                {/* Delete */}
                <button
                  onClick={() => {
                    setSectionToDelete(section);
                    setDeleteDialogOpen(true);
                  }}
                  className="p-2 rounded text-red-400 hover:bg-red-500/20 transition-colors"
                  title="Elimina"
                  data-testid={`delete-section-${section.id}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {sections.length === 0 && (
          <div className="text-center py-12 text-zinc-500">
            <Layers size={48} className="mx-auto mb-4 opacity-50" />
            <p>Nessuna sezione creata</p>
            <p className="text-sm mt-1">Crea la prima sezione per la homepage</p>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle>Conferma Eliminazione</AlertDialogTitle>
            <AlertDialogDescription>
              Sei sicuro di voler eliminare la sezione "{sectionToDelete?.name}"? 
              Questa azione non può essere annullata.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 border-zinc-700 hover:bg-zinc-700">
              Annulla
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
