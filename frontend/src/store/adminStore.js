import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const API_URL = process.env.REACT_APP_BACKEND_URL;

export const useAdminStore = create(
  persist(
    (set, get) => ({
      // Auth state
      token: null,
      admin: null,
      isAuthenticated: false,

      // Data state
      contents: [],
      heroConfig: null,
      sections: [],
      logs: [],
      stats: null,

      // Loading states
      loading: false,
      error: null,

      // Auth actions
      login: async (email, password) => {
        set({ loading: true, error: null });
        try {
          const response = await fetch(`${API_URL}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Login failed');
          }
          
          const data = await response.json();
          set({
            token: data.access_token,
            admin: data.admin,
            isAuthenticated: true,
            loading: false,
          });
          return { success: true };
        } catch (error) {
          set({ loading: false, error: error.message });
          return { success: false, error: error.message };
        }
      },

      logout: async () => {
        const { token } = get();
        try {
          await fetch(`${API_URL}/api/admin/logout`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}` 
            },
          });
        } catch (e) {
          // Ignore logout errors
        }
        set({ token: null, admin: null, isAuthenticated: false });
      },

      // Content actions
      fetchContents: async (filters = {}) => {
        const { token } = get();
        set({ loading: true });
        try {
          const params = new URLSearchParams();
          if (filters.visibility) params.append('visibility', filters.visibility);
          if (filters.content_type) params.append('content_type', filters.content_type);
          if (filters.search) params.append('search', filters.search);
          
          const response = await fetch(`${API_URL}/api/admin/contents?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          
          if (!response.ok) throw new Error('Failed to fetch contents');
          
          const data = await response.json();
          set({ contents: data.contents, loading: false });
        } catch (error) {
          set({ loading: false, error: error.message });
        }
      },

      importContent: async (tmdbId, contentType) => {
        const { token } = get();
        set({ loading: true });
        try {
          const response = await fetch(`${API_URL}/api/admin/contents/import`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ tmdb_id: tmdbId, content_type: contentType }),
          });
          
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Import failed');
          }
          
          const content = await response.json();
          set((state) => ({ 
            contents: [content, ...state.contents],
            loading: false 
          }));
          return { success: true, content };
        } catch (error) {
          set({ loading: false, error: error.message });
          return { success: false, error: error.message };
        }
      },

      updateContent: async (contentId, updates) => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/contents/${contentId}`, {
            method: 'PUT',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(updates),
          });
          
          if (!response.ok) throw new Error('Update failed');
          
          const updated = await response.json();
          set((state) => ({
            contents: state.contents.map(c => c.id === contentId ? updated : c)
          }));
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },

      deleteContent: async (contentId) => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/contents/${contentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
          });
          
          if (!response.ok) throw new Error('Delete failed');
          
          set((state) => ({
            contents: state.contents.filter(c => c.id !== contentId)
          }));
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },

      // Hero actions
      fetchHeroConfig: async () => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/hero`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          
          if (!response.ok) throw new Error('Failed to fetch hero');
          
          const data = await response.json();
          set({ heroConfig: data });
        } catch (error) {
          set({ error: error.message });
        }
      },

      saveHeroConfig: async (config) => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/hero`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(config),
          });
          
          if (!response.ok) throw new Error('Failed to save hero');
          
          const data = await response.json();
          set({ heroConfig: data });
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },

      // Sections actions
      fetchSections: async () => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/sections`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          
          if (!response.ok) throw new Error('Failed to fetch sections');
          
          const data = await response.json();
          set({ sections: data.sections });
        } catch (error) {
          set({ error: error.message });
        }
      },

      createSection: async (section) => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/sections`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(section),
          });
          
          if (!response.ok) throw new Error('Failed to create section');
          
          const data = await response.json();
          set((state) => ({ sections: [...state.sections, data] }));
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },

      updateSection: async (sectionId, updates) => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/sections/${sectionId}`, {
            method: 'PUT',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(updates),
          });
          
          if (!response.ok) throw new Error('Update failed');
          
          const updated = await response.json();
          set((state) => ({
            sections: state.sections.map(s => s.id === sectionId ? updated : s)
          }));
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },

      deleteSection: async (sectionId: string): Promise<{ success: boolean; error?: string }> => {
  const { token } = get();

  try {
    const response = await fetch(
      `${API_URL}/api/admin/sections/${sectionId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Delete failed");
    }

    set((state) => ({
      sections: state.sections.filter(
        (s) => s.id !== sectionId
      ),
    }));

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error?.message || "Unknown error",
    };
  }
},

      reorderSections: async (orders) => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/sections/reorder`, {
            method: 'PUT',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(orders),
          });
          
          if (!response.ok) throw new Error('Reorder failed');
          
          // Update local state
          set((state) => ({
            sections: state.sections.map(s => {
              const order = orders.find(o => o.id === s.id);
              return order ? { ...s, order: order.order } : s;
            }).sort((a, b) => a.order - b.order)
          }));
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },

      // Stats actions
      fetchStats: async () => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/stats`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          
          if (!response.ok) throw new Error('Failed to fetch stats');
          
          const data = await response.json();
          set({ stats: data });
        } catch (error) {
          set({ error: error.message });
        }
      },

      // Logs actions
      fetchLogs: async (limit = 100) => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/logs?limit=${limit}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          
          if (!response.ok) throw new Error('Failed to fetch logs');
          
          const data = await response.json();
          set({ logs: data.logs });
        } catch (error) {
          set({ error: error.message });
        }
      },

      // TMDB search
      searchTMDB: async (query, contentType) => {
        const { token } = get();
        try {
          const response = await fetch(
            `${API_URL}/api/tmdb/search/${contentType}?query=${encodeURIComponent(query)}`,
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          
          if (!response.ok) throw new Error('Search failed');
          
          return await response.json();
        } catch (error) {
          return { results: [] };
        }
      },

      // Fetch available contents for hero
      fetchAvailableContents: async () => {
        const { token } = get();
        try {
          const response = await fetch(`${API_URL}/api/admin/contents/available`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          
          if (!response.ok) throw new Error('Failed to fetch');
          
          return await response.json();
        } catch (error) {
          return { contents: [] };
        }
      },

      // Clear error
      clearError: () => set({ error: null }),
    }),
    {
      name: 'admin-storage',
      partialize: (state) => ({ 
        token: state.token, 
        admin: state.admin,
        isAuthenticated: state.isAuthenticated 
      }),
    }
  )
);
