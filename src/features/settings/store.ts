import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StreamType } from "@/types";

export interface ViewSettings {
  theme: "dark" | "light";
  gridCols: 1 | 2 | 3 | 4 | 5 | 6;
  pageSize: 1 | 2 | 3 | 4 | 5 | 6;
  autoRefresh: boolean;
  defaultStream: StreamType;
}

interface SettingsState {
  settings: ViewSettings;
  setSettings: (patch: Partial<ViewSettings>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: {
        theme: "dark",
        gridCols: 3,
        pageSize: 4,
        autoRefresh: true,
        defaultStream: "HLS Stable",
      },
      setSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
    }),
    {
      name: "cctv-lite-settings",
      version: 2,
      merge: (persisted, current) => {
        const saved = persisted as Partial<SettingsState> | undefined;
        return {
          ...current,
          ...saved,
          settings: {
            ...current.settings,
            ...(saved?.settings || {}),
          },
        };
      },
    },
  ),
);
