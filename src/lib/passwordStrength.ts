export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Belum diisi" | "Sangat lemah" | "Lemah" | "Cukup" | "Kuat" | "Sangat kuat";
  suggestions: string[];
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return {
      score: 0,
      label: "Belum diisi",
      suggestions: ["Gunakan minimal 8 karakter."],
    };
  }

  const suggestions: string[] = [];
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  let raw = 0;

  if (password.length >= 8) raw += 1;
  else suggestions.push("Gunakan minimal 8 karakter.");
  if (password.length >= 12) raw += 1;
  if (password.length >= 16) raw += 1;
  if (hasLower && hasUpper) raw += 1;
  else suggestions.push("Campurkan huruf besar dan kecil.");
  if (hasNumber) raw += 1;
  else suggestions.push("Tambahkan angka.");
  if (hasSymbol) raw += 1;
  else suggestions.push("Tambahkan simbol.");

  if (password.length < 6) return { score: 0, label: "Sangat lemah", suggestions };
  if (raw <= 1) return { score: 1, label: "Lemah", suggestions };
  if (raw <= 3) return { score: 2, label: "Cukup", suggestions };
  if (raw <= 5) return { score: 3, label: "Kuat", suggestions };
  return { score: 4, label: "Sangat kuat", suggestions };
}
