// @ts-nocheck
import { adminAPI } from './api';

async function request(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  const token = adminAPI.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`/api/player/artwork${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Richiesta artwork fallita');
  return data;
}

export const netflixArtworkAPI = {
  getConfig: () => request('/admin/config'),
  updateConfig: (data: any) => request('/admin/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  test: () => request('/admin/test', { method: 'POST' }),
  list: (status?: string) => request(`/admin/matches${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  preview: (type: string, tmdbId: number, context = 'home', viewport = 'desktop', refresh = false) => {
    const qs = new URLSearchParams({ context, viewport, refresh: String(refresh) });
    return request(`/admin/${type}/${tmdbId}?${qs.toString()}`);
  },
  autoMatch: (type: string, tmdbId: number) => request(`/admin/${type}/${tmdbId}/auto-match`, { method: 'POST' }),
  manualMatch: (type: string, tmdbId: number, netflixId: string) => request(`/admin/${type}/${tmdbId}/manual-match`, {
    method: 'PUT',
    body: JSON.stringify({ netflix_id: netflixId }),
  }),
  block: (type: string, tmdbId: number) => request(`/admin/${type}/${tmdbId}/block`, { method: 'PUT' }),
  resetMatch: (type: string, tmdbId: number) => request(`/admin/${type}/${tmdbId}/match`, { method: 'DELETE' }),
  setOverride: (type: string, tmdbId: number, data: any) => request(`/admin/${type}/${tmdbId}/override`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  resetOverride: (type: string, tmdbId: number, context: string) => request(`/admin/${type}/${tmdbId}/override?context=${encodeURIComponent(context)}`, { method: 'DELETE' }),
};
