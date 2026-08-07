import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom performs no layout: it has no ResizeObserver, and every element reports zero
// offsetWidth/offsetHeight. @tanstack/react-virtual (the Reporting tab's row virtualizer) reads both
// to size its scroll viewport and measure rows - with the jsdom defaults it would see a zero-height
// viewport and render nothing. A flat non-zero size is enough: the virtualizer's `overscan` widens
// the rendered range by index count (not distance), so for the small row counts used in tests every
// row still ends up rendered regardless of the exact stubbed height.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 40 });
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 800 });

// For the same reason jsdom does no scrolling either, so it leaves `scrollIntoView` undefined rather
// than stubbed - and a component that repositions the window after a layout change (the Reporting
// tab's expand/collapse) would throw on the call. A no-op is enough to exercise the path and to spy on.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}