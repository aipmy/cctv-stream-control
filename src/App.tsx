import { useState, Component, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { ThemeManager } from "@/components/ThemeManager";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import LiveView from "./pages/LiveView";
import Cameras from "./pages/Cameras";
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import Events from "./pages/Events";
import Playback from "./pages/Playback";
import NotFound from "./pages/NotFound";
import { BootstrapGate } from "@/features/auth/BootstrapGate";

interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("Uncaught render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-background text-foreground">
          <div className="max-w-md space-y-4">
            <h2 className="text-lg font-bold">Gagal Memuat Tampilan</h2>
            <p className="text-xs text-muted-foreground">
              Terjadi masalah koneksi atau pembaruan sesi saat memuat halaman ini di perangkat Anda.
            </p>
            <button
              onClick={() => {
                sessionStorage.clear();
                window.location.reload();
              }}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const App = () => {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeManager />
        <Toaster />
        <Sonner position="bottom-right" richColors closeButton />
        <ErrorBoundary>
          <BrowserRouter>
            <BootstrapGate>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/live" element={<LiveView />} />
                  <Route path="/cameras" element={<Cameras />} />
                  <Route path="/playback" element={<Playback />} />
                  <Route path="/events" element={<Events />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/settings" element={<Settings />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BootstrapGate>
          </BrowserRouter>
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
