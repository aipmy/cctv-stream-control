import { evaluatePasswordStrength } from "@/lib/passwordStrength";
import { cn } from "@/lib/utils";

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
    </div>
  );
}
