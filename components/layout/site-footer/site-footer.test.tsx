import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("renders the brand name and call to action", () => {
    render(<SiteFooter />);

    expect(screen.getByText("InnovationistTech Demos")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /start a project/i }),
    ).toHaveAttribute("href", "/contact");
  });

  it("renders each navigation column heading", () => {
    render(<SiteFooter />);

    for (const title of ["Services", "Company", "Resources"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("renders navigation links with the correct hrefs", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("link", { name: "AI & LLM Apps" })).toHaveAttribute(
      "href",
      "/services/ai",
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "/about",
    );
    expect(screen.getByRole("link", { name: "Case Studies" })).toHaveAttribute(
      "href",
      "/work",
    );
  });

  it("renders social links that open in a new tab", () => {
    render(<SiteFooter />);

    const githubLink = screen.getByRole("link", { name: "GitHub" });
    expect(githubLink).toHaveAttribute(
      "href",
      "https://github.com/innovationisttechnology",
    );
    expect(githubLink).toHaveAttribute("target", "_blank");
    expect(githubLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the copyright with the current year", () => {
    render(<SiteFooter />);

    const currentYear = new Date().getFullYear().toString();
    expect(
      screen.getByText(new RegExp(`${currentYear}.*All rights reserved`)),
    ).toBeInTheDocument();
  });
});
