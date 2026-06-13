import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Cctv, User, Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { GlobalThemeToggle } from "@/components/GlobalThemeToggle";
import { useLangStore } from "@/features/ui/useLangStore";
import { cn } from "@/lib/utils";

export default function Login() {
  const navigate = useNavigate();
  const { user, loginWithPassword } = useAuth();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { t, lang } = useTranslation();
  const setLang = useLangStore((s) => s.setLang);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const found = await loginWithPassword(u, p);
      toast.success(
        lang === "id" 
          ? `Selamat datang, ${found.username}` 
          : `Welcome, ${found.username}`
      );
      navigate("/");
    } catch (err) {
      toast.error(
        err instanceof Error 
          ? err.message 
          : (lang === "id" ? "Username atau password salah" : t("loginFailed"))
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-background relative">
      {/* Top right language and theme selectors */}
      <div className="fixed top-2.5 right-24 z-[70] flex items-center gap-3">
        <div className="inline-flex rounded-md border bg-card/90 backdrop-blur p-0.5 select-none shrink-0 shadow-sm border-border/70">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setLang("en")}
            className={cn(
              "h-7 px-2.5 text-[10px] font-semibold uppercase rounded-sm",
              lang === "en" && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
            )}
          >
            EN
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setLang("id")}
            className={cn(
              "h-7 px-2.5 text-[10px] font-semibold uppercase rounded-sm",
              lang === "id" && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
            )}
          >
            ID
          </Button>
        </div>
      </div>
      <GlobalThemeToggle />

      {/* Brand panel */}
      <div className="hidden lg:flex relative overflow-hidden bg-gradient-primary">
        <div className="absolute inset-0 cctv-feed opacity-40" />
        <div className="relative z-10 p-12 flex flex-col justify-between text-primary-foreground">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-md bg-background/15 backdrop-blur flex items-center justify-center">
              <Cctv className="h-5 w-5" />
            </div>
            <div className="font-semibold tracking-tight">CCTV Monitoring Lite</div>
          </div>
          <div>
            <h1 className="text-4xl font-semibold tracking-tight leading-tight max-w-md">
              {lang === "id" 
                ? "Pantau seluruh kamera CCTV anda dari satu dashboard ringan." 
                : "Monitor all your CCTV cameras from a single lightweight dashboard."}
            </h1>
            <p className="mt-4 text-primary-foreground/85 max-w-md">
              {lang === "id"
                ? "Multi-site, multi-brand, multi-stream. Dirancang untuk operator yang butuh respon cepat dan tampilan yang tidak berisik."
                : "Multi-site, multi-brand, multi-stream. Designed for operators needing fast response times and clean visuals."}
            </p>
            <div className="mt-8 grid grid-cols-3 gap-3 max-w-md">
              {["Universal", "Bardi", "EZVIZ", "Hikvision", "HLS", "MJPEG"].map((b) => (
                <div key={b} className="text-xs text-center py-2 rounded-md bg-background/10 backdrop-blur border border-background/20">{b}</div>
              ))}
            </div>
          </div>
          <div className="text-xs text-primary-foreground/70">v1.0 · Operator Console</div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 lg:hidden mb-6">
            <Cctv className="h-5 w-5 text-primary" />
            <span className="font-semibold">CCTV Monitoring Lite</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("loginTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("loginSub")}</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider">{t("username")}</Label>
              <div className="relative mt-1.5">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={u} onChange={(e) => setU(e.target.value)} placeholder={lang === "id" ? "Masukkan username" : "Enter username"} className="pl-10" autoFocus />
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider">{t("password")}</Label>
              <div className="relative mt-1.5">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showPassword ? "text" : "password"}
                  value={p}
                  onChange={(e) => setP(e.target.value)}
                  placeholder="••••••"
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" disabled={submitting} className="w-full bg-gradient-primary text-primary-foreground hover:opacity-95 shadow-glow">
              {submitting ? (lang === "id" ? "Memvalidasi..." : t("loading")) : t("loginButton")}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
