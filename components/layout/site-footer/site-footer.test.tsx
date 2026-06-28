import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("renders the brand name and call to action", () => {
    render(<SiteFooter />);

    expect(screen.getByText("InnovationistTech Demos")).toBeInTheDocument();
    for (const cta of screen.getAllByRole("link", {
      name: /let's build together/i,
    })) {
      expect(cta).toHaveAttribute(
        "href",
        "https://innovationisttech.com/contact-us/lets-build-together",
      );
    }
  });

  it("renders each navigation column heading", () => {
    render(<SiteFooter />);

    for (const title of ["Services", "Company", "Get Started"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("links marketing pages out to the main company site", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "https://innovationisttech.com/#about-us",
    );
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute(
      "href",
      "https://innovationisttech.com/blog",
    );
    expect(
      screen.getByRole("link", { name: "Schedule a Call" }),
    ).toHaveAttribute(
      "href",
      "https://innovationisttech.com/contact-us/schedule-a-call",
    );
  });

  it("renders the real contact details", () => {
    render(<SiteFooter />);

    expect(
      screen.getByRole("link", { name: "inquiries@innovationisttech.com" }),
    ).toHaveAttribute("href", "mailto:inquiries@innovationisttech.com");
    expect(
      screen.getByRole("link", { name: "+1 (943) 267 4613" }),
    ).toHaveAttribute("href", "tel:+19432674613");
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
