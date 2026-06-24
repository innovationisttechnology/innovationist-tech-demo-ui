import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { SiteHeader } from "./site-header";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

describe("SiteHeader", () => {
  it("renders the logo linking to the home page", () => {
    render(<SiteHeader />);

    const logoLinks = screen.getAllByRole("link", {
      name: /InnovationistTech Demos/i,
    });
    expect(logoLinks[0]).toHaveAttribute("href", "/");
  });

  it("renders the desktop navigation links", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "Services" })).toHaveAttribute(
      "href",
      "/services",
    );
    expect(screen.getByRole("link", { name: "Work" })).toHaveAttribute(
      "href",
      "/work",
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "/about",
    );
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute(
      "href",
      "/blog",
    );
  });

  it("links to the GitHub repository in a new tab", () => {
    render(<SiteHeader />);

    const githubLink = screen.getByRole("link", { name: /GitHub/i });
    expect(githubLink).toHaveAttribute(
      "href",
      "https://github.com/innovationisttechnology",
    );
    expect(githubLink).toHaveAttribute("target", "_blank");
  });

  it("opens the mobile menu when the trigger is pressed", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("link", { name: "Services" }),
    ).toBeInTheDocument();
  });
});
