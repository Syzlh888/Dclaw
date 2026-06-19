import { create } from 'zustand';
import { getSystemConfig, setSecondaryPassword, verifySecondaryPassword, fetchOsDict, saveOsDict, fetchServerLocationDict, saveServerLocationDict } from '../services/serverService';

interface SystemConfigState {
  hasSecondaryPassword: boolean;
  loading: boolean;
  osList: { name: string; shortName: string }[];
  serverLocationList: { name: string; shortName: string }[];
  loadConfig: () => Promise<void>;
  setSecondaryPassword: (password: string, oldPassword?: string) => Promise<void>;
  verifySecondaryPassword: (password: string) => Promise<boolean>;
  loadOsDict: () => Promise<void>;
  saveOsDict: (osList: { name: string; shortName: string }[]) => Promise<void>;
  loadServerLocationDict: () => Promise<void>;
  saveServerLocationDict: (list: { name: string; shortName: string }[]) => Promise<void>;
}

export const useSystemConfigStore = create<SystemConfigState>((set) => ({
  hasSecondaryPassword: false,
  loading: false,
  osList: [],
  serverLocationList: [],

  loadConfig: async () => {
    set({ loading: true });
    try {
      const cfg = await getSystemConfig();
      set({ hasSecondaryPassword: cfg.hasSecondaryPassword, loading: false });
    } catch { set({ loading: false }); }
  },

  setSecondaryPassword: async (password, oldPassword) => {
    await setSecondaryPassword(password, oldPassword);
    set({ hasSecondaryPassword: true });
  },

  verifySecondaryPassword: async (password) => {
    try {
      await verifySecondaryPassword(password);
      return true;
    } catch { return false; }
  },

  loadOsDict: async () => {
    try {
      const { osList } = await fetchOsDict();
      set({ osList: osList || [] });
    } catch { /* ignore */ }
  },

  saveOsDict: async (osList) => {
    await saveOsDict(osList);
    set({ osList });
  },

  loadServerLocationDict: async () => {
    try {
      const { list } = await fetchServerLocationDict();
      set({ serverLocationList: list || [] });
    } catch { /* ignore */ }
  },

  saveServerLocationDict: async (list) => {
    await saveServerLocationDict(list);
    set({ serverLocationList: list });
  },
}));
