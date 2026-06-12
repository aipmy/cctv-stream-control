import { Moon, Sun } from "lucide-react";
import { useSettings } from "@/features/settings/store";
import { cn } from "@/lib/utils";

export function GlobalThemeToggle() {
  const { settings, setSettings } = useSettings();
  const dark = settings.theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-label="Ganti tema gelap atau terang"
      aria-checked={dark}
      title={dark ? "Gunakan tema terang" : "Gunakan tema gelap"}
      onClick={() => setSettings({ theme: dark ? "light" : "dark" })}
      className="fixed right-3 top-2.5 z-[70] h-9 w-[68px] rounded-full border border-border/70 bg-card/90 p-1 shadow-sm backdrop-blur transition-colors hover:border-primary/50"
    >
      <span
        className={cn(
          "absolute left-1 top-1 h-7 w-7 rounded-full bg-primary shadow-sm transition-transform duration-300 ease-out",
          dark ? "translate-x-8" : "translate-x-0",
        )}
      />
      <span className="relative z-10 flex h-full items-center justify-between px-1">
        <Sun className={cn("h-3.5 w-3.5 transition-colors", dark ? "text-muted-foreground" : "text-primary-foreground")} />
        <Moon className={cn("h-3.5 w-3.5 transition-colors", dark ? "text-primary-foreground" : "text-muted-foreground")} />
      </span>
    </button>
  );
}
