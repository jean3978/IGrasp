// React 19 no longer declares a global `JSX` namespace, but hast-util-to-jsx-runtime's types refer
// to it. Alias it to React's, as the library's documentation recommends.
import type { JSX as ReactJsx } from 'react/jsx-runtime';

declare global {
  namespace JSX {
    type ElementClass = ReactJsx.ElementClass;
    type Element = ReactJsx.Element;
    type IntrinsicElements = ReactJsx.IntrinsicElements;
  }
}
