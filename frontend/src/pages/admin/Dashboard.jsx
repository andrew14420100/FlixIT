import React, { useEffect } from 'react';
import { useAdminStore } from '../../store/adminStore';
import { 
  Film, 
  Tv, 
  Eye, 
  EyeOff, 
  TrendingUp, 
  Clock,
  ImageIcon
} from 'lucide-react';

const StatCard = ({ title, value, icon: Icon, color, subtext }) => (
  <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-6 hover:border-white/10 transition-all group">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-zinc-500 text-sm uppercase tracking-wider font-medium">{title}</p>
        <p className="text-4xl font-bold mt-2" style={{ fontFamily: 'Unbounded, sans-serif' }}>
          {value}
        </p>
        {subtext && <p className="text-zinc-500 text-sm mt-1">{subtext}</p>}
      </div>
      <div className={`p-3 rounded-xl ${color} bg-opacity-10 group-hover:scale-110 transition-transform`}>
        <Icon size={24} className={color.replace('bg-', 'text-')} />
      </div>
    </div>
  </div>
);

export default function AdminDashboard() {
  const { stats, fetchStats, logs, fetchLogs } = useAdminStore();

  useEffect(() => {
    fetchStats();
    fetchLogs(10);
  }, [fetchStats, fetchLogs]);

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getActionColor = (action) => {
    const colors = {
      'LOGIN': 'text-blue-400',
      'LOGOUT': 'text-zinc-400',
      'CONTENT_IMPORT': 'text-green-400',
      'VISIBILITY_CHANGE': 'text-yellow-400',
      'HERO_CHANGE': 'text-purple-400',
      'CONTENT_DELETE': 'text-red-400',
      'SECTION_CREATE': 'text-cyan-400',
      'SECTION_UPDATE': 'text-cyan-400',
      'SECTION_DELETE': 'text-red-400',
    };
    return colors[action] || 'text-zinc-400';
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300" data-testid="admin-dashboard">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'Unbounded, sans-serif' }}>
          Dashboard
        </h1>
        <p className="text-zinc-400 mt-1">Panoramica del sistema</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Totale Contenuti"
          value={stats?.total_contents || 0}
          icon={TrendingUp}
          color="bg-blue-500"
        />
        <StatCard
          title="Contenuti Visibili"
          value={stats?.visible_contents || 0}
          icon={Eye}
          color="bg-green-500"
        />
        <StatCard
          title="Contenuti Nascosti"
          value={stats?.hidden_contents || 0}
          icon={EyeOff}
          color="bg-yellow-500"
        />
        <StatCard
          title="Film"
          value={stats?.total_movies || 0}
          icon={Film}
          color="bg-purple-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* More Stats */}
        <StatCard
          title="Serie TV"
          value={stats?.total_tv || 0}
          icon={Tv}
          color="bg-cyan-500"
        />

        {/* Last Content */}
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-6 hover:border-white/10 transition-all">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-green-500/10">
              <Clock size={24} className="text-green-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-zinc-500 text-sm uppercase tracking-wider font-medium">Ultimo Aggiunto</p>
              <p className="font-semibold mt-1 truncate">
                {stats?.last_content?.title || 'Nessun contenuto'}
              </p>
              <p className="text-zinc-500 text-sm mt-1">
                {stats?.last_content?.created_at ? formatDate(stats.last_content.created_at) : 'N/A'}
              </p>
            </div>
          </div>
        </div>

        {/* Current Hero */}
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-6 hover:border-white/10 transition-all">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-purple-500/10">
              <ImageIcon size={24} className="text-purple-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-zinc-500 text-sm uppercase tracking-wider font-medium">Hero Attuale</p>
              <p className="font-semibold mt-1 truncate">
                {stats?.current_hero?.title_override || 'TMDB ID: ' + (stats?.current_hero?.tmdb_id || 'Non configurato')}
              </p>
              <p className="text-zinc-500 text-sm mt-1 capitalize">
                {stats?.current_hero?.content_type || 'N/A'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-white/5">
          <h2 className="text-xl font-semibold">Attività Recenti</h2>
        </div>
        <div className="divide-y divide-white/5">
          {logs && logs.length > 0 ? (
            logs.slice(0, 10).map((log, index) => (
              <div key={log.id || index} className="px-6 py-4 hover:bg-white/5 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`font-mono text-sm ${getActionColor(log.action)}`}>
                      {log.action}
                    </span>
                    <span className="text-zinc-400 text-sm">{log.details}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-zinc-500 text-sm">{formatDate(log.timestamp)}</p>
                    <p className="text-zinc-600 text-xs">{log.admin_email}</p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="px-6 py-8 text-center text-zinc-500">
              Nessuna attività recente
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
