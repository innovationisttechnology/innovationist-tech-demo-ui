import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ThemeToggle } from "./theme-toggle";

const setTheme = vi.fn();
let resolvedTheme = "light";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme, setTheme }),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    setTheme.mockClear();
    resolvedTheme = "light";
  });

  it("renders an accessible toggle button", () => {
    render(<ThemeToggle />);

    expect(
      screen.getByRole("button", { name: "Toggle theme" }),
    ).toBeInTheDocument();
  });

  it("switches to dark when the current theme is light", async () => {
    resolvedTheme = "light";
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));

    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("switches to light when the current theme is dark", async () => {
    resolvedTheme = "dark";
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));

    expect(setTheme).toHaveBeenCalledWith("light");
  });
});
