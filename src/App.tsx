import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { ThemeManager } from "@/components/ThemeManager";
import { lazy, Suspense } from "react";
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const LiveView = lazy(() => import("./pages/LiveView"));
const Cameras = lazy(() => import("./pages/Cameras"));
const Users = lazy(() => import("./pages/Users"));
const Settings = lazy(() => import("./pages/Settings"));
const Events = lazy(() => import("./pages/Events"));
const Playback = lazy(() => import("./pages/Playback"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
import { BootstrapGate } from "@/features/auth/BootstrapGate";
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
        <BrowserRouter>
          <BootstrapGate>
            <Suspense fallback={
              <div className="flex h-screen w-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            }>
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
            </Suspense>
          </BootstrapGate>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
