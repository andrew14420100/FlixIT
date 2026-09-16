import React, { useEffect, useState } from 'react';
import { useAdminStore } from '../../store/adminStore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { toast } from 'sonner';
import { Save, Monitor, Smartphone, Film, Tv, ImageIcon } from 'lucide-react';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export default function AdminHero() {
  const { 
    heroConfig, 
    fetchHeroConfig, 
    saveHeroConfig,
    fetchAvailableContents 
  } = useAdminStore();

  const [availableContents, setAvailableContents] = useState([]);
  const [selectedContent, setSelectedContent] = useState(null);
  const [previewMode, setPreviewMode] = useState('desktop');
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    content_id: '',
    tmdb_id: 0,
    content_type: '',
    title_override: '',
    description_override: '',
    backdrop_override: '',
    available_season: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    await fetchHeroConfig();
    const data = await fetchAvailableContents();
    setAvailableContents(data.contents || []);
  };

  useEffect(() => {
    if (heroConfig && heroConfig.content_id) {
      setFormData({
        content_id: heroConfig.content_id || '',
        tmdb_id: heroConfig.tmdb_id || 0,
        content_type: heroConfig.content_type || '',
        title_override: heroConfig.title_override || '',
        description_override: heroConfig.description_override || '',
        backdrop_override: heroConfig.backdrop_override || '',
        available_season: heroConfig.available_season || ''
      });
      
      const content = availableContents.find(c => c.id === heroConfig.content_id);
      if (content) setSelectedContent(content);
    }
  }, [heroConfig, availableContents]);

  const handleContentSelect = (contentId) => {
    const content = availableContents.find(c => c.id === contentId);
    if (content) {
      setSelectedContent(content);
      setFormData(prev => ({
        ...prev,
        content_id: content.id,
        tmdb_id: content.tmdb_id,
        content_type: content.content_type
      }));
    }
  };

  const handleSave = async () => {
    if (!formData.content_id) {
      toast.error('Seleziona un contenuto');
      return;
    }

    setSaving(true);
    const result = await saveHeroConfig(formData);
    setSaving(false);

    if (result.success) {
      toast.success('Hero section salvata con successo');
    } else {
      toast.error(result.error || 'Errore durante il salvataggio');
    }
  };

  // Preview data
  const previewTitle = formData.title_override || selectedContent?.title || 'Titolo del Contenuto';
  const previewDescription = formData.description_override || selectedContent?.overview || 'Descrizione del contenuto selezionato. Questa è una preview della hero section.';
  const previewBackdrop = formData.backdrop_override || 
    (selectedContent?.backdrop_path ? `${TMDB_IMAGE_BASE}/original${selectedContent.backdrop_path}` : null);

  return (
    <div className="space-y-6 animate-in fade-in duration-300" data-testid="admin-hero-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'Unbounded, sans-serif' }}>
            Hero Section
          </h1>
          <p className="text-zinc-400 mt-1">Configura il contenuto in evidenza</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant={previewMode === 'desktop' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPreviewMode('desktop')}
            className={previewMode === 'desktop' ? 'bg-zinc-700' : 'border-zinc-700'}
          >
            <Monitor size={16} className="mr-1" />
            Desktop
          </Button>
          <Button
            variant={previewMode === 'mobile' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPreviewMode('mobile')}
            className={previewMode === 'mobile' ? 'bg-zinc-700' : 'border-zinc-700'}
          >
            <Smartphone size={16} className="mr-1" />
            Mobile
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration Panel */}
        <div className="space-y-6 bg-zinc-900/50 border border-white/5 rounded-xl p-6">
          <h2 className="text-xl font-semibold">Configurazione</h2>

          {/* Content Selection */}
          <div className="space-y-2">
            <Label>Seleziona Contenuto</Label>
            <Select 
              value={formData.content_id} 
              onValueChange={handleContentSelect}
            >
              <SelectTrigger className="bg-zinc-800 border-zinc-700" data-testid="hero-content-select">
                <SelectValue placeholder="Scegli un contenuto..." />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700 max-h-60">
                {availableContents.map((content) => (
                  <SelectItem key={content.id} value={content.id}>
                    <div className="flex items-center gap-2">
                      {content.content_type === 'movie' ? (
                        <Film size={14} className="text-purple-400" />
                      ) : (
                        <Tv size={14} className="text-cyan-400" />
                      )}
                      <span>{content.title}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableContents.length === 0 && (
              <p className="text-zinc-500 text-sm">
                Nessun contenuto disponibile. Importa prima alcuni contenuti.
              </p>
            )}
          </div>

          {/* Title Override */}
          <div className="space-y-2">
            <Label>Titolo (override)</Label>
            <Input
              placeholder="Lascia vuoto per usare titolo TMDB"
              value={formData.title_override}
              onChange={(e) => setFormData(prev => ({ ...prev, title_override: e.target.value }))}
              className="bg-zinc-800 border-zinc-700"
              data-testid="hero-title-input"
            />
          </div>

          {/* Description Override */}
          <div className="space-y-2">
            <Label>Descrizione (override)</Label>
            <Textarea
              placeholder="Lascia vuoto per usare descrizione TMDB"
              value={formData.description_override}
              onChange={(e) => setFormData(prev => ({ ...prev, description_override: e.target.value }))}
              className="bg-zinc-800 border-zinc-700 min-h-[100px]"
              data-testid="hero-description-input"
            />
          </div>

          {/* Backdrop Override */}
          <div className="space-y-2">
            <Label>URL Backdrop (override)</Label>
            <Input
              placeholder="https://example.com/image.jpg"
              value={formData.backdrop_override}
              onChange={(e) => setFormData(prev => ({ ...prev, backdrop_override: e.target.value }))}
              className="bg-zinc-800 border-zinc-700"
              data-testid="hero-backdrop-input"
            />
          </div>

          {/* Available Season (for TV shows) */}
          {formData.content_type === 'tv' && (
            <div className="space-y-2">
              <Label>Stagione Disponibile</Label>
              <Input
                placeholder="Es: Stagione 1-3 disponibili"
                value={formData.available_season}
                onChange={(e) => setFormData(prev => ({ ...prev, available_season: e.target.value }))}
                className="bg-zinc-800 border-zinc-700"
                data-testid="hero-season-input"
              />
            </div>
          )}

          {/* Save Button */}
          <Button 
            onClick={handleSave} 
            disabled={saving || !formData.content_id}
            className="w-full bg-[#E50914] hover:bg-[#B20710] shadow-lg shadow-red-900/30"
            data-testid="save-hero-btn"
          >
            <Save size={18} className="mr-2" />
            {saving ? 'Salvataggio...' : 'Salva Configurazione'}
          </Button>
        </div>

        {/* Live Preview */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <ImageIcon size={20} />
            Anteprima Live
          </h2>

          <div 
            className={`relative rounded-xl overflow-hidden border border-white/10 ${
              previewMode === 'mobile' ? 'max-w-[375px] mx-auto' : ''
            }`}
            style={{ aspectRatio: previewMode === 'desktop' ? '16/9' : '9/16' }}
          >
            {/* Background */}
            {previewBackdrop ? (
              <img
                src={previewBackdrop}
                alt="Hero backdrop"
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-900" />
            )}

            {/* Overlay gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />

            {/* Content */}
            <div className={`absolute bottom-0 left-0 right-0 p-6 ${previewMode === 'mobile' ? 'text-center' : ''}`}>
              {/* Type Badge */}
              <div className={`flex items-center gap-2 mb-3 ${previewMode === 'mobile' ? 'justify-center' : ''}`}>
                {formData.content_type === 'movie' ? (
                  <span className="px-2 py-1 bg-purple-500/80 rounded text-xs font-medium">FILM</span>
                ) : formData.content_type === 'tv' ? (
                  <span className="px-2 py-1 bg-cyan-500/80 rounded text-xs font-medium">SERIE TV</span>
                ) : null}
              </div>

              {/* Title */}
              <h2 
                className={`font-bold mb-2 ${previewMode === 'desktop' ? 'text-4xl' : 'text-2xl'}`}
                style={{ fontFamily: 'Unbounded, sans-serif' }}
              >
                {previewTitle}
              </h2>

              {/* Available Season */}
              {formData.available_season && (
                <p className="text-green-400 text-sm mb-2 font-medium">
                  {formData.available_season}
                </p>
              )}

              {/* Description */}
              <p className={`text-zinc-300 ${previewMode === 'desktop' ? 'text-base max-w-xl' : 'text-sm'} line-clamp-3`}>
                {previewDescription}
              </p>

              {/* Fake buttons */}
              <div className={`flex gap-3 mt-4 ${previewMode === 'mobile' ? 'justify-center' : ''}`}>
                <div className="bg-white text-black px-6 py-2 rounded font-semibold text-sm">
                  ▶ Play
                </div>
                <div className="bg-zinc-600/80 px-6 py-2 rounded font-semibold text-sm">
                  ⓘ Info
                </div>
              </div>
            </div>
          </div>

          {/* Preview Info */}
          <div className="bg-zinc-900/50 border border-white/5 rounded-lg p-4">
            <p className="text-zinc-400 text-sm">
              <strong>Nota:</strong> Questa è un'anteprima. L'aspetto finale potrebbe variare leggermente in base al layout del sito.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
