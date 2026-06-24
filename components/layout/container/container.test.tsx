import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Container } from "./container";

describe("Container", () => {
  it("renders its children inside a div by default", () => {
    render(<Container>hello</Container>);

    const element = screen.getByText("hello");
    expect(element.tagName).toBe("DIV");
  });

  it("renders as the element provided via the `as` prop", () => {
    render(<Container as="section">section content</Container>);

    const element = screen.getByText("section content");
    expect(element.tagName).toBe("SECTION");
  });

  it("merges a custom className with the module class", () => {
    render(<Container className="extra-class">content</Container>);

    expect(screen.getByText("content")).toHaveClass("extra-class");
  });

  it("forwards arbitrary props to the underlying element", () => {
    render(
      <Container data-testid="wrapper" aria-label="region">
        content
      </Container>,
    );

    const element = screen.getByTestId("wrapper");
    expect(element).toHaveAttribute("aria-label", "region");
  });
});
