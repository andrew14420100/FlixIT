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
  Search, 
  Film, 
  Tv, 
  Trash2, 
  Eye, 
  EyeOff,
  Download,
  Filter
} from 'lucide-react';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export default function AdminContents() {
  const { 
    contents, 
    fetchContents, 
    importContent, 
    updateContent, 
    deleteContent,
    searchTMDB,
    loading 
  } = useAdminStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterVisibility, setFilterVisibility] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [contentToDelete, setContentToDelete] = useState(null);
  
  // Import form state
  const [importTmdbId, setImportTmdbId] = useState('');
  const [importType, setImportType] = useState('movie');
  const [tmdbSearch, setTmdbSearch] = useState('');
  const [tmdbResults, setTmdbResults] = useState([]);
  const [searchingTmdb, setSearchingTmdb] = useState(false);

  useEffect(() => {
    loadContents();
  }, [filterVisibility, filterType]);

  const loadContents = () => {
    const filters = {};
    if (filterVisibility !== 'all') filters.visibility = filterVisibility;
    if (filterType !== 'all') filters.content_type = filterType;
    if (searchQuery) filters.search = searchQuery;
    fetchContents(filters);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    loadContents();
  };

  const handleTmdbSearch = async () => {
    if (!tmdbSearch.trim()) return;
    setSearchingTmdb(true);
    const results = await searchTMDB(tmdbSearch, importType);
    setTmdbResults(results.results || []);
    setSearchingTmdb(false);
  };

  const handleImport = async () => {
    if (!importTmdbId) {
      toast.error('Inserisci un ID TMDB');
      return;
    }
    
    const result = await importContent(parseInt(importTmdbId), importType);
    if (result.success) {
      toast.success(`"${result.content.title}" importato con successo`);
      setImportDialogOpen(false);
      setImportTmdbId('');
      setTmdbSearch('');
      setTmdbResults([]);
    } else {
      toast.error(result.error);
    }
  };

  const handleToggleVisibility = async (content) => {
    const result = await updateContent(content.id, { visible: !content.visible });
    if (result.success) {
      toast.success(`Visibilità aggiornata`);
    } else {
      toast.error('Errore durante l\'aggiornamento');
    }
  };

  const handleDelete = async () => {
    if (!contentToDelete) return;
    const result = await deleteContent(contentToDelete.id);
    if (result.success) {
      toast.success('Contenuto eliminato');
    } else {
      toast.error('Errore durante l\'eliminazione');
    }
    setDeleteDialogOpen(false);
    setContentToDelete(null);
  };

  const selectFromTmdb = (item) => {
    setImportTmdbId(item.id.toString());
  };

  const filteredContents = contents.filter(c => {
    if (searchQuery && !c.title?.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300" data-testid="admin-contents-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'Unbounded, sans-serif' }}>
            Gestione Contenuti
          </h1>
          <p className="text-zinc-400 mt-1">Importa e gestisci film e serie TV</p>
        </div>
        
        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              className="bg-[#E50914] hover:bg-[#B20710] shadow-lg shadow-red-900/30"
              data-testid="import-content-btn"
            >
              <Plus size={18} className="mr-2" />
              Importa Contenuto
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-zinc-900 border-zinc-800 max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Importa da TMDB</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              {/* Content Type */}
              <div className="space-y-2">
                <Label>Tipo di Contenuto</Label>
                <Select value={importType} onValueChange={setImportType}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="movie">Film</SelectItem>
                    <SelectItem value="tv">Serie TV</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Search TMDB */}
              <div className="space-y-2">
                <Label>Cerca su TMDB</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Cerca titolo..."
                    value={tmdbSearch}
                    onChange={(e) => setTmdbSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleTmdbSearch()}
                    className="bg-zinc-800 border-zinc-700"
                    data-testid="tmdb-search-input"
                  />
                  <Button 
                    onClick={handleTmdbSearch} 
                    disabled={searchingTmdb}
                    variant="secondary"
                    className="bg-zinc-800 hover:bg-zinc-700"
                  >
                    <Search size={18} />
                  </Button>
                </div>
              </div>

              {/* Search Results */}
              {tmdbResults.length > 0 && (
                <div className="space-y-2">
                  <Label>Risultati ({tmdbResults.length})</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-60 overflow-y-auto p-1">
                    {tmdbResults.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => selectFromTmdb(item)}
                        className={`relative aspect-[2/3] rounded-md overflow-hidden border-2 transition-all ${
                          importTmdbId === item.id.toString() 
                            ? 'border-[#E50914] ring-2 ring-[#E50914]/50' 
                            : 'border-transparent hover:border-white/30'
                        }`}
                      >
                        {item.poster_path ? (
                          <img
                            src={`${TMDB_IMAGE_BASE}/w200${item.poster_path}`}
                            alt={item.title || item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                            <Film size={24} className="text-zinc-600" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-2">
                          <span className="text-xs font-medium line-clamp-2">
                            {item.title || item.name}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Manual ID Input */}
              <div className="space-y-2">
                <Label>ID TMDB (manuale)</Label>
                <Input
                  placeholder="Es: 550 (Fight Club)"
                  value={importTmdbId}
                  onChange={(e) => setImportTmdbId(e.target.value)}
                  className="bg-zinc-800 border-zinc-700"
                  data-testid="tmdb-id-input"
                />
              </div>

              <Button 
                onClick={handleImport} 
                disabled={!importTmdbId || loading}
                className="w-full bg-[#E50914] hover:bg-[#B20710]"
                data-testid="confirm-import-btn"
              >
                <Download size={18} className="mr-2" />
                Importa
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center bg-zinc-900/50 border border-white/5 rounded-xl p-4">
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-zinc-500" />
          <span className="text-zinc-400 text-sm">Filtri:</span>
        </div>
        
        <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <Input
              placeholder="Cerca per titolo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-800 border-zinc-700"
              data-testid="content-search-input"
            />
          </div>
        </form>

        <Select value={filterVisibility} onValueChange={setFilterVisibility}>
          <SelectTrigger className="w-[140px] bg-zinc-800 border-zinc-700">
            <SelectValue placeholder="Visibilità" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            <SelectItem value="all">Tutti</SelectItem>
            <SelectItem value="visible">Visibili</SelectItem>
            <SelectItem value="hidden">Nascosti</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px] bg-zinc-800 border-zinc-700">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            <SelectItem value="all">Tutti</SelectItem>
            <SelectItem value="movie">Film</SelectItem>
            <SelectItem value="tv">Serie TV</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {filteredContents.map((content) => (
          <div
            key={content.id}
            className={`relative aspect-[2/3] rounded-lg overflow-hidden group border transition-all ${
              content.visible 
                ? 'border-white/10 hover:border-white/30' 
                : 'border-red-500/30 opacity-60'
            }`}
            data-testid={`content-card-${content.tmdb_id}`}
          >
            {content.poster_path ? (
              <img
                src={`${TMDB_IMAGE_BASE}/w300${content.poster_path}`}
                alt={content.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                {content.content_type === 'movie' ? (
                  <Film size={32} className="text-zinc-600" />
                ) : (
                  <Tv size={32} className="text-zinc-600" />
                )}
              </div>
            )}

            {/* Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <p className="font-semibold text-sm line-clamp-2 mb-3">{content.title}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleVisibility(content)}
                    className={`flex-1 flex items-center justify-center gap-1 py-2 rounded text-xs font-medium transition-colors ${
                      content.visible 
                        ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                        : 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                    }`}
                    data-testid={`toggle-visibility-${content.tmdb_id}`}
                  >
                    {content.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    {content.visible ? 'Visibile' : 'Nascosto'}
                  </button>
                  <button
                    onClick={() => {
                      setContentToDelete(content);
                      setDeleteDialogOpen(true);
                    }}
                    className="p-2 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                    data-testid={`delete-content-${content.tmdb_id}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Type Badge */}
            <div className="absolute top-2 left-2">
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                content.content_type === 'movie' 
                  ? 'bg-purple-500/80' 
                  : 'bg-cyan-500/80'
              }`}>
                {content.content_type === 'movie' ? 'Film' : 'Serie'}
              </span>
            </div>

            {/* Visibility Badge */}
            {!content.visible && (
              <div className="absolute top-2 right-2">
                <EyeOff size={16} className="text-red-400" />
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredContents.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <Film size={48} className="mx-auto mb-4 opacity-50" />
          <p>Nessun contenuto trovato</p>
          <p className="text-sm mt-1">Importa contenuti da TMDB per iniziare</p>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle>Conferma Eliminazione</AlertDialogTitle>
            <AlertDialogDescription>
              Sei sicuro di voler eliminare "{contentToDelete?.title}"? 
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
