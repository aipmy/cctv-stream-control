import { useEffect } from "react";
import { useSettings } from "@/features/settings/store";

export function ThemeManager() {
  const theme = useSettings((s) => s.settings.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [theme]);
  return null;
}
