import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lacks these browser APIs; minimal stand-ins are enough for components that only subscribe.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {
      /* no layout in jsdom */
    }
    unobserve() {
      /* no layout in jsdom */
    }
    disconnect() {
      /* no layout in jsdom */
    }
  };
}

// jsdom has no layout, so every element is 0×0 and virtualized lists (TanStack Virtual reads
// clientWidth/clientHeight) would render no rows. Give elements a nominal viewport size.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get: () => 800,
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {
    /* no layout in jsdom */
  };
}

afterEach(() => {
  cleanup();
});
