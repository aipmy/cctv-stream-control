import { create } from "zustand";
import { persist } from "zustand/middleware";

type Language = "en" | "id";

interface LangState {
  lang: Language;
  setLang: (lang: Language) => void;
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      lang: "en",
      setLang: (lang) => set({ lang }),
    }),
    { name: "cctv-lang" }
  )
);
