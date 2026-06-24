import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { ThemeProvider } from "./theme-provider";

const nextThemesProviderMock = vi.fn();

vi.mock("next-themes", () => ({
  ThemeProvider: (props: Record<string, unknown>) => {
    nextThemesProviderMock(props);
    return (
      <div data-testid="next-themes-provider">
        {props.children as React.ReactNode}
      </div>
    );
  },
}));

describe("ThemeProvider", () => {
  it("renders its children", () => {
    render(
      <ThemeProvider>
        <span>themed child</span>
      </ThemeProvider>,
    );

    expect(screen.getByText("themed child")).toBeInTheDocument();
  });

  it("forwards configuration props to next-themes", () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <span>child</span>
      </ThemeProvider>,
    );

    expect(nextThemesProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attribute: "class",
        defaultTheme: "system",
        enableSystem: true,
      }),
    );
  });
});
