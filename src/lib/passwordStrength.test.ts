import { describe, expect, test } from "vitest";
import { evaluatePasswordStrength } from "./passwordStrength";

describe("evaluatePasswordStrength", () => {
  test("labels an empty password without pretending it has strength", () => {
    expect(evaluatePasswordStrength("")).toMatchObject({
      score: 0,
      label: "Belum diisi",
    });
  });

  test("moves from very weak to very strong as character variety increases", () => {
    expect(evaluatePasswordStrength("abc").label).toBe("Sangat lemah");
    expect(evaluatePasswordStrength("abcdefgh").label).toBe("Lemah");
    expect(evaluatePasswordStrength("Abcdef12").label).toBe("Cukup");
    expect(evaluatePasswordStrength("Abcdef12!xyz").label).toBe("Kuat");
    expect(evaluatePasswordStrength("Abcdef12!xyz-Long").label).toBe("Sangat kuat");
  });

  test("returns actionable suggestions without exposing the password", () => {
    const result = evaluatePasswordStrength("lowercase");
    expect(result.suggestions.join(" ")).toMatch(/huruf besar|angka|simbol/i);
    expect(JSON.stringify(result)).not.toContain("lowercase");
  });
});
