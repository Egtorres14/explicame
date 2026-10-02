import type { Strategy } from "./guide.js";
import { installDomRuntime } from "./domRuntimeImpl.js";
import type { ElementFacts } from "./safety.js";

export interface ObservedElement {
  id: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  tour?: string;
  testid?: string;
  options?: string[];
  disabled: boolean;
  inForm: boolean;
  box: { x: number; y: number; w: number; h: number };
}

export interface Observation {
  url: string;
  title: string;
  elements: ObservedElement[];
  truncated: boolean;
}

export interface ExplicameRuntime {
  observe(max?: number): Observation;
  byId(id: string): Element | null;
  uniqueStrategies(el: Element): Strategy[];
  candidateStrategies(el: Element): Strategy[];
  resolve(strategies: Strategy[]): Element | null;
  matchAll(strategy: Strategy): Element[];
  describe(el: Element): ElementFacts;
  roleOf(el: Element): string;
  nameOf(el: Element): string;
  labelOf(el: Element): string;
  cssPath(el: Element): string;
}

declare global {
  interface Window {
    __explicame?: ExplicameRuntime;
    __explicameNoLayout?: boolean;
  }
}

/** The runtime as text, for Playwright: the same function the player calls directly. */
export const DOM_RUNTIME = `(${installDomRuntime.toString()})();`;
export { installDomRuntime };
