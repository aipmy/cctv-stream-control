import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { authApi, setupApi } from "@/lib/api";
import { SetupPage } from "./SetupPage";
import { useAuth } from "./store";

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      {label}
    </div>
  );
}

export function BootstrapGate({ children }: { children: React.ReactNode }) {
  const { user, token, hasHydrated, setSession, logout } = useAuth();
  const setup = useQuery({
    queryKey: ["setup-status"],
    queryFn: setupApi.status,
    retry: false,
    staleTime: Infinity, // setup status almost never changes once initialised
  });
  const session = useQuery({
    queryKey: ["auth-me", token],
    queryFn: authApi.me,
    enabled: hasHydrated && setup.data?.required === false && Boolean(token),
    retry: false,
    staleTime: 5 * 60 * 1000, // revalidate session at most every 5 minutes
  });

  useEffect(() => {
    if (session.data?.user && token) setSession(session.data.user, token);
  }, [session.data, setSession, token]);

  useEffect(() => {
    if (session.isError) logout();
  }, [logout, session.isError]);

  useEffect(() => {
    if (hasHydrated && user && !token) logout();
  }, [hasHydrated, logout, token, user]);

  if (!hasHydrated || setup.isPending) return <LoadingScreen label="Memeriksa instalasi..." />;
  if (setup.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Backend tidak dapat dihubungi</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {setup.error instanceof Error ? setup.error.message : "Pemeriksaan setup gagal"}
          </p>
        </div>
      </div>
    );
  }
  if (setup.data.required) return <SetupPage />;
  if (token && session.isPending) return <LoadingScreen label="Memvalidasi sesi..." />;
  if (token && session.isError) return <LoadingScreen label="Mengakhiri sesi tidak valid..." />;
  if (user && !token) return <LoadingScreen label="Membersihkan sesi..." />;

  return children;
}
