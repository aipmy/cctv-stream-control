import { useLangStore } from "@/features/ui/useLangStore";
import { translations, type TranslationKey } from "@/lib/locales";

export function useTranslation() {
  const lang = useLangStore((s) => s.lang);
  const dict = translations[lang] || translations.en;

  const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
    let text = dict[key] as string;
    if (!text) {
      // Fallback to English
      text = translations.en[key] as string || String(key);
    }

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`{${k}}`, "g"), String(v));
      });
    }

    return text;
  };

  return { t, lang };
}
export type { TranslationKey };
