import "@testing-library/jest-dom/vitest";
import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount/cleanup React trees after every test
afterEach(() => {
  cleanup();
});

// jsdom ships no ResizeObserver, and Radix primitives (ScrollArea, Select)
// construct one in a layout effect — without this any test rendering them
// throws on mount rather than failing on an assertion.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom has no Element.scrollTo, which smooth scrolling needs. Node-env
// test files have no Element at all.
if (typeof Element !== "undefined") {
  Element.prototype.scrollTo ??= function () {};
}

// Mock next/navigation (App Router hooks)
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
