// @ts-nocheck
import type { Content, HeroSettings, Section, DashboardStats, AdminLog, PaginatedResponse, ApiError } from '../types';

const API_BASE = '/api';

class AdminAPIService {
  private token: string | null = null;

  setToken(token: string | null): void {
    this.token = token;
    if (token) {
      localStorage.setItem('admin_token', token);
    } else {
      localStorage.removeItem('admin_token');
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('admin_token');
    }
    return this.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = this.getToken();
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({ detail: 'Richiesta fallita' }));
      throw new Error(error.detail || 'Richiesta fallita');
    }

    return response.json();
  }

  // Authentication
  async login(email: string, password: string): Promise<{ token: string; email: string; expiresIn: number }> {
    const data = await this.request<{ token: string; email: string; expiresIn: number }>(
      '/admin/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    );
    this.setToken(data.token);
    return data;
  }

  async getProfile(): Promise<{ email: string }> {
    return this.request<{ email: string }>('/admin/me');
  }

  logout(): void {
    this.setToken(null);
  }

  // Contents
  async getContents(params?: {
    available?: boolean;
    type?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Content>> {
    const searchParams = new URLSearchParams();
    if (params?.available !== undefined) searchParams.set('available', String(params.available));
    if (params?.type) searchParams.set('type', params.type);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    
    const query = searchParams.toString();
    return this.request<PaginatedResponse<Content>>(`/admin/contents${query ? `?${query}` : ''}`);
  }

  async getContent(tmdbId: number): Promise<Content> {
    return this.request<Content>(`/admin/contents/${tmdbId}`);
  }

  async createContent(data: {
    tmdbId: number;
    type: 'movie' | 'tv';
    available?: boolean;
    availableSeason?: number | null;
  }): Promise<{ success: boolean; content: Content }> {
    return this.request<{ success: boolean; content: Content }>('/admin/contents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateContent(
    tmdbId: number,
    data: { available?: boolean; availableSeason?: number | null }
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/admin/contents/${tmdbId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteContent(tmdbId: number): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/admin/contents/${tmdbId}`, {
      method: 'DELETE',
    });
  }

  // Hero
  async getHero(): Promise<HeroSettings | null> {
    return this.request<HeroSettings | null>('/admin/hero');
  }

  async updateHero(data: {
    contentId: string;
    customTitle?: string | null;
    customDescription?: string | null;
    customBackdrop?: string | null;
    seasonLabel?: string | null;
  }): Promise<{ success: boolean; hero: HeroSettings }> {
    return this.request<{ success: boolean; hero: HeroSettings }>('/admin/hero', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Sections
  async getSections(): Promise<{ items: Section[] }> {
    return this.request<{ items: Section[] }>('/admin/sections');
  }

  async createSection(data: {
    name: string;
    section_type: string;
    media_type: 'movie' | 'tv';
    visible?: boolean;
    order?: number;
  }): Promise<Section> {
    return this.request<Section>('/admin/sections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSection(name: string, data: { 
    active?: boolean; 
    order?: number;
    name?: string;
    section_type?: string;
    media_type?: 'movie' | 'tv';
  }): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/admin/sections/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSection(name: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/admin/sections/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  async reorderSections(orders: { name: string; order: number }[]): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/admin/sections/reorder', {
      method: 'PUT',
      body: JSON.stringify(orders),
    });
  }

  async getAvailableSections(): Promise<{ available: any[]; all: any[] }> {
    return this.request<{ available: any[]; all: any[] }>('/admin/available-sections');
  }

  async addPredefinedSection(name: string): Promise<any> {
    return this.request<any>('/admin/sections/add-predefined', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }


  // Menu Items
  async getMenuItems(): Promise<{ items: any[] }> {
    return this.request<{ items: any[] }>('/admin/menu');
  }

  async createMenuItem(data: { name: string; path: string; order: number; active: boolean }): Promise<any> {
    return this.request<any>('/admin/menu', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateMenuItem(id: string, data: { name?: string; path?: string; order?: number; active?: boolean }): Promise<any> {
    return this.request<any>(`/admin/menu/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteMenuItem(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/admin/menu/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async reorderMenuItems(orders: { id: string; order: number }[]): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/admin/menu/reorder', {
      method: 'PUT',
      body: JSON.stringify({ items: orders }),
    });
  }

  // Stats
  async getStats(): Promise<DashboardStats> {
    return this.request<DashboardStats>('/admin/stats');
  }

  // Logs
  async getLogs(params?: {
    action?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<AdminLog>> {
    const searchParams = new URLSearchParams();
    if (params?.action) searchParams.set('action', params.action);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    
    const query = searchParams.toString();
    return this.request<PaginatedResponse<AdminLog>>(`/admin/logs${query ? `?${query}` : ''}`);
  }
}

export const adminAPI = new AdminAPIService();
export default adminAPI;
