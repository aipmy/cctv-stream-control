import { fireEvent, render, screen } from "@testing-library/react";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";
import { GlobalThemeToggle } from "./GlobalThemeToggle";
import { useSettings } from "@/features/settings/store";

test("password strength meter describes the supplied password", () => {
  render(<PasswordStrengthMeter password="Abcdef12!xyz" />);
  expect(screen.getByText("Kuat")).toBeInTheDocument();
  expect(screen.getByText(/kekuatan password/i)).toBeInTheDocument();
});

test("global theme toggle switches the persisted theme", () => {
  useSettings.setState((state) => ({
    settings: { ...state.settings, theme: "dark" },
  }));
  render(<GlobalThemeToggle />);

  const toggle = screen.getByRole("switch", { name: /tema/i });
  expect(toggle).toHaveAttribute("aria-checked", "true");
  fireEvent.click(toggle);
  expect(useSettings.getState().settings.theme).toBe("light");
});
