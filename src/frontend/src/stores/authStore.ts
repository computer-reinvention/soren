import { create } from 'zustand';
import { API_BASE } from '../lib/constants';

interface AuthState {
  username: string | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  username: null,
  token: localStorage.getItem('soren_token'),
  isAuthenticated: false,
  isLoading: true,

  login: async (username: string, password: string) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Invalid credentials');
    }
    const data = await res.json();
    localStorage.setItem('soren_token', data.token);
    set({ username: data.username, token: data.token, isAuthenticated: true });
  },

  logout: async () => {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    localStorage.removeItem('soren_token');
    set({ username: null, token: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const token = localStorage.getItem('soren_token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        credentials: 'include',
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        set({ username: data.username, isAuthenticated: true, isLoading: false });
      } else {
        localStorage.removeItem('soren_token');
        set({ username: null, token: null, isAuthenticated: false, isLoading: false });
      }
    } catch {
      localStorage.removeItem('soren_token');
      set({ username: null, token: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
