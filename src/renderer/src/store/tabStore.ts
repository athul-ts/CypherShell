import { create } from 'zustand';

export interface Tab {
  id: string; // 'home' or `profile-${profileId}`
  type: 'home' | 'profile-detail';
  title: string;
  profileId: string;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Tab) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  reorderTabs: (startIndex: number, endIndex: number) => void;
}

export const useTabStore = create<TabState>((set) => ({
  tabs: [{ id: 'home', type: 'home', title: 'Home', profileId: '' }],
  activeTabId: 'home',

  addTab: (tab) =>
    set((state) => {
      const exists = state.tabs.find((t) => t.id === tab.id && t.type === tab.type);
      if (exists) return { activeTabId: tab.id };
      return {
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
      };
    }),

  removeTab: (id) =>
    set((state) => {
      if (id === 'home') return state; // Never allow removing the home tab
      const newTabs = state.tabs.filter((t) => t.id !== id);
      const newActive = state.activeTabId === id
        ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null)
        : state.activeTabId;
      return { tabs: newTabs, activeTabId: newActive };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  reorderTabs: (startIndex, endIndex) =>
    set((state) => {
      const newTabs = Array.from(state.tabs);
      const [removed] = newTabs.splice(startIndex, 1);
      newTabs.splice(endIndex, 0, removed);
      return { tabs: newTabs };
    }),
}));
