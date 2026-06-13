import { evaluatePasswordStrength } from "@/lib/passwordStrength";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

export function PasswordStrengthMeter({ password }: { password: string }) {
  const strength = evaluatePasswordStrength(password);
  const activeSegments = password ? strength.score + 1 : 0;
  const color = {
    0: "bg-destructive",
    1: "bg-orange-500",
    2: "bg-warning",
    3: "bg-info",
    4: "bg-success",
  }[strength.score];

  return (
    <div className="mt-2 space-y-1.5" aria-live="polite">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Kekuatan password</span>
        <span className="font-medium">{strength.label}</span>
      </div>
      <div className="grid grid-cols-5 gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={cn(
              "h-1.5 rounded-full bg-muted transition-colors duration-300",
              segment < activeSegments && color,
            )}
          />
        ))}
      </div>
      {strength.suggestions.length > 0 && password && (
        <p className="text-[11px] text-muted-foreground">
          Saran: {strength.suggestions.slice(0, 2).join(" ")}
        </p>
      )}

      {password && (
        <div className="grid grid-cols-2 gap-2 mt-2 text-[10px] sm:text-[11px]">
          <div className={cn("flex items-center gap-1.5", password.length >= 8 ? "text-success" : "text-muted-foreground")}>
            {password.length >= 8 ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
            Minimal 8 karakter
          </div>
          <div className={cn("flex items-center gap-1.5", /[a-z]/.test(password) && /[A-Z]/.test(password) ? "text-success" : "text-muted-foreground")}>
            {/[a-z]/.test(password) && /[A-Z]/.test(password) ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
            Huruf besar & kecil
          </div>
          <div className={cn("flex items-center gap-1.5", /\d/.test(password) ? "text-success" : "text-muted-foreground")}>
            {/\d/.test(password) ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
            Terdapat angka
          </div>
          <div className={cn("flex items-center gap-1.5", /[^a-zA-Z0-9]/.test(password) ? "text-success" : "text-muted-foreground")}>
            {/[^a-zA-Z0-9]/.test(password) ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
            Terdapat simbol
          </div>
        </div>
      )}
    </div>
  );
}
