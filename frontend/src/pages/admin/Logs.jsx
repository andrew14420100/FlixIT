import React, { useEffect, useState } from 'react';
import { useAdminStore } from '../../store/adminStore';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { 
  Search, 
  FileText,
  LogIn,
  LogOut,
  Download,
  Eye,
  Trash2,
  ImageIcon,
  Layers,
  RefreshCw
} from 'lucide-react';
import { Button } from '../../components/ui/button';

const actionIcons = {
  'LOGIN': LogIn,
  'LOGOUT': LogOut,
  'LOGIN_FAILED': LogIn,
  'CONTENT_IMPORT': Download,
  'VISIBILITY_CHANGE': Eye,
  'CONTENT_UPDATE': FileText,
  'CONTENT_DELETE': Trash2,
  'HERO_CHANGE': ImageIcon,
  'SECTION_CREATE': Layers,
  'SECTION_UPDATE': Layers,
  'SECTION_DELETE': Trash2,
  'SECTIONS_REORDER': Layers,
  'SYSTEM_INIT': RefreshCw,
};

const actionColors = {
  'LOGIN': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'LOGOUT': 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  'LOGIN_FAILED': 'bg-red-500/20 text-red-400 border-red-500/30',
  'CONTENT_IMPORT': 'bg-green-500/20 text-green-400 border-green-500/30',
  'VISIBILITY_CHANGE': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'CONTENT_UPDATE': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'CONTENT_DELETE': 'bg-red-500/20 text-red-400 border-red-500/30',
  'HERO_CHANGE': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'SECTION_CREATE': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'SECTION_UPDATE': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'SECTION_DELETE': 'bg-red-500/20 text-red-400 border-red-500/30',
  'SECTIONS_REORDER': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'SYSTEM_INIT': 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
};

export default function AdminLogs() {
  const { logs, fetchLogs } = useAdminStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAction, setFilterAction] = useState('all');

  useEffect(() => {
    fetchLogs(200);
  }, [fetchLogs]);

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getRelativeTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Adesso';
    if (minutes < 60) return `${minutes}m fa`;
    if (hours < 24) return `${hours}h fa`;
    if (days < 7) return `${days}g fa`;
    return '';
  };

  const filteredLogs = logs.filter(log => {
    if (filterAction !== 'all' && log.action !== filterAction) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        log.action?.toLowerCase().includes(query) ||
        log.details?.toLowerCase().includes(query) ||
        log.admin_email?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const uniqueActions = [...new Set(logs.map(l => l.action))];

  return (
    <div className="space-y-6 animate-in fade-in duration-300" data-testid="admin-logs-page">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'Unbounded, sans-serif' }}>
          Activity Logs
        </h1>
        <p className="text-zinc-400 mt-1">Registro delle attività amministrative</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center bg-zinc-900/50 border border-white/5 rounded-xl p-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <Input
              placeholder="Cerca nei log..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-800 border-zinc-700"
              data-testid="logs-search-input"
            />
          </div>
        </div>

        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-[180px] bg-zinc-800 border-zinc-700">
            <SelectValue placeholder="Filtra per azione" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            <SelectItem value="all">Tutte le azioni</SelectItem>
            {uniqueActions.map((action) => (
              <SelectItem key={action} value={action}>
                {action.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button 
          variant="outline" 
          onClick={() => fetchLogs(200)}
          className="border-zinc-700 hover:bg-zinc-800"
          data-testid="refresh-logs-btn"
        >
          <RefreshCw size={16} className="mr-2" />
          Aggiorna
        </Button>
      </div>

      {/* Logs List - Terminal Style */}
      <div className="bg-[#0A0A0A] border border-white/5 rounded-xl overflow-hidden font-mono">
        {/* Terminal Header */}
        <div className="bg-zinc-900 px-4 py-2 border-b border-white/5 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-zinc-500 text-xs ml-4">activity_logs.sh</span>
          <span className="text-zinc-600 text-xs ml-auto">
            {filteredLogs.length} entries
          </span>
        </div>

        {/* Logs */}
        <div className="max-h-[600px] overflow-y-auto">
          {filteredLogs.length > 0 ? (
            filteredLogs.map((log, index) => {
              const Icon = actionIcons[log.action] || FileText;
              const colorClass = actionColors[log.action] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
              
              return (
                <div 
                  key={log.id || index}
                  className="px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors"
                  data-testid={`log-entry-${index}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className={`p-2 rounded border ${colorClass} mt-0.5`}>
                      <Icon size={14} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colorClass}`}>
                          {log.action}
                        </span>
                        <span className="text-zinc-500 text-xs">
                          {getRelativeTime(log.timestamp)}
                        </span>
                      </div>
                      <p className="text-zinc-300 text-sm mt-1 break-all">
                        {log.details}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-zinc-600">
                        <span>📧 {log.admin_email}</span>
                        <span>🕐 {formatDate(log.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-12 text-zinc-500">
              <FileText size={48} className="mx-auto mb-4 opacity-50" />
              <p>Nessun log trovato</p>
              <p className="text-sm mt-1">I log delle attività appariranno qui</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
