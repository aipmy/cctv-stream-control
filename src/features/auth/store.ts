import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserSummary } from "@/types";
import { authApi, setApiToken } from "@/lib/api";

interface AuthState {
  user: UserSummary | null;
  token: string | null;
  hasHydrated: boolean;
  setSession: (user: UserSummary, token: string) => void;
  loginWithPassword: (username: string, password: string) => Promise<UserSummary>;
  logout: () => void;
  logoutWithAudit: () => Promise<void>;
  updatePinnedCameras: (cameraIds: string[]) => Promise<UserSummary>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<UserSummary>;
  markHydrated: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      hasHydrated: false,
      setSession: (user, token) => {
        setApiToken(token);
        set({ user, token });
      },
      loginWithPassword: async (username, password) => {
        const result = await authApi.login(username, password);
        setApiToken(result.token);
        set({ user: result.user, token: result.token });
        return result.user;
      },
      logout: () => {
        setApiToken(null);
        set({ user: null, token: null });
      },
      logoutWithAudit: async () => {
        try {
          await authApi.logout();
        } finally {
          setApiToken(null);
          set({ user: null, token: null });
        }
      },
      updatePinnedCameras: async (cameraIds) => {
        const previous = get().user;
        if (!previous) throw new Error("Sesi pengguna tidak tersedia");
        const pinnedCameraIds = [...new Set(cameraIds.filter(Boolean))];
        set({
          user: {
            ...previous,
            preferences: { pinnedCameraIds },
          },
        });
        try {
          const result = await authApi.updatePreferences(pinnedCameraIds);
          set({ user: result.user });
          return result.user;
        } catch (error) {
          set({ user: previous });
          throw error;
        }
      },
      changePassword: async (currentPassword, newPassword) => {
        const result = await authApi.changePassword(currentPassword, newPassword);
        set({ user: result.user });
        return result.user;
      },
      markHydrated: () => set({ hasHydrated: true }),
    }),
    {
      name: "cctv-lite-auth",
      partialize: (state) => ({ user: state.user, token: state.token }),
      onRehydrateStorage: () => (state) => {
        setApiToken(state?.token || null);
        state?.markHydrated();
      },
    },
  ),
);
