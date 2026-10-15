'use client';

import { create } from 'zustand';

import { AuthMethod, authMethodStorage } from '@/lib/authMethodStorage';
import { selectedOrgStorage } from '@/lib/selectedOrgStorage';

const SIDEBAR_SECTIONS_KEY = 'quasar_sidebar_sections';
const SIDEBAR_COLLAPSED_KEY = 'quasar_sidebar_collapsed';

interface UIStore {
  siwxError: string;
  setSiwxError: (error: string) => void;
  clearSiwxError: () => void;
  pending2fa: boolean;
  setPending2fa: (value: boolean) => void;
  set2faRedirect: (token: string) => void;
  authView: 'login' | 'register' | 'forgot-password' | 'verification-sent';
  setAuthView: (view: 'login' | 'register' | 'forgot-password' | 'verification-sent') => void;
  selectedOrgId: string | null;
  selectedOrgUserId: string | null;
  selectedOrgHydrated: boolean;
  hydrateSelectedOrgId: (userId: string) => void;
  resetSelectedOrgId: () => void;
  setSelectedOrgId: (id: string | null) => void;
  sidebarOpenSections: Record<string, boolean>;
  setSidebarOpenSections: (sections: Record<string, boolean>) => void;
  toggleSidebarSection: (id: string) => void;
  isFeedbackModalOpen: boolean;
  setIsFeedbackModalOpen: (value: boolean) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (value: boolean) => void;
  toggleSidebarCollapse: () => void;
  authMethod: AuthMethod | null;
  authStorageHydrated: boolean;
  setAuthMethod: (method: AuthMethod | null) => void;
}

const getInitialState = () => {
  if (typeof window === 'undefined') {
    return {
      selectedOrgId: null,
      selectedOrgUserId: null,
      selectedOrgHydrated: false,
      sidebarOpenSections: {
        org_primary: true,
        org_settings: true,
      },
      isSidebarCollapsed: false,
      authMethod: null,
      authStorageHydrated: false,
    };
  }

  const sectionsRaw = localStorage.getItem(SIDEBAR_SECTIONS_KEY);
  const authMethod = authMethodStorage.get();
  const isCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';

  let sidebarSections = {
    org_primary: true,
    org_settings: true,
  };

  if (sectionsRaw) {
    try {
      sidebarSections = JSON.parse(sectionsRaw);
    } catch (e) {
      console.error('Failed to parse sidebar sections', e);
    }
  }

  return {
    selectedOrgId: null,
    selectedOrgUserId: null,
    selectedOrgHydrated: false,
    sidebarOpenSections: sidebarSections,
    isSidebarCollapsed: isCollapsed,
    authMethod: authMethod || null,
    authStorageHydrated: true,
  };
};

export const useUIStore = create<UIStore>((set) => {
  const initialState = getInitialState();

  return {
    ...initialState,
    siwxError: '',
    setSiwxError: (error) => set({ siwxError: error }),
    clearSiwxError: () => set({ siwxError: '' }),
    pending2fa: false,
    setPending2fa: (value) => set({ pending2fa: value }),
    set2faRedirect: (token) => set({ pending2fa: true, siwxError: `2fa:${token}` }),
    authView: 'register',
    setAuthView: (view) => set({ authView: view }),
    hydrateSelectedOrgId: (userId) => {
      set({
        selectedOrgId: selectedOrgStorage.get(userId),
        selectedOrgUserId: userId,
        selectedOrgHydrated: true,
      });
    },
    resetSelectedOrgId: () =>
      set({
        selectedOrgId: null,
        selectedOrgUserId: null,
        selectedOrgHydrated: false,
      }),
    setSelectedOrgId: (id) => {
      const userId = useUIStore.getState().selectedOrgUserId;
      if (id && userId) {
        selectedOrgStorage.set(userId, id);
      }
      set({ selectedOrgId: id });
    },
    setSidebarOpenSections: (sections) => {
      localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(sections));
      set({ sidebarOpenSections: sections });
    },
    toggleSidebarSection: (id) => {
      set((state) => {
        const newSections = { ...state.sidebarOpenSections, [id]: !state.sidebarOpenSections[id] };
        localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(newSections));
        return { sidebarOpenSections: newSections };
      });
    },
    isFeedbackModalOpen: false,
    setIsFeedbackModalOpen: (value) => set({ isFeedbackModalOpen: value }),
    setIsSidebarCollapsed: (value) => {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? 'true' : 'false');
      set({ isSidebarCollapsed: value });
    },
    toggleSidebarCollapse: () => {
      set((state) => {
        const newValue = !state.isSidebarCollapsed;
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, newValue ? 'true' : 'false');
        return { isSidebarCollapsed: newValue };
      });
    },
    setAuthMethod: (method) => {
      if (method) {
        authMethodStorage.set(method);
      } else {
        authMethodStorage.remove();
      }
      set({ authMethod: method, authStorageHydrated: true });
    },
  };
});

export function initUIStoreFromStorage() {
  // Re-sync in case of external storage changes or SSR hydration mismatch
  const state = getInitialState();
  const current = useUIStore.getState();
  useUIStore.setState({
    ...state,
    selectedOrgId: current.selectedOrgId,
    selectedOrgUserId: current.selectedOrgUserId,
    selectedOrgHydrated: current.selectedOrgHydrated,
  });
}
