import type { ElementHandle, Page } from "playwright";
import type { Action, ElementFacts, Observation, Strategy } from "@explicame/core";
import { settle } from "./session.js";

export async function observe(page: Page, max = 150): Promise<Observation> {
  return page.evaluate((limit) => window.__explicame!.observe(limit), max);
}

export async function elementFacts(page: Page, id: string): Promise<ElementFacts | null> {
  return page.evaluate((elementId) => {
    const runtime = window.__explicame!;
    const element = runtime.byId(elementId);
    return element ? runtime.describe(element) : null;
  }, id);
}

export async function stableStrategies(page: Page, id: string): Promise<Strategy[]> {
  return page.evaluate((elementId) => {
    const runtime = window.__explicame!;
    const element = runtime.byId(elementId);
    return element ? runtime.uniqueStrategies(element) : [];
  }, id);
}

export async function handleById(page: Page, id: string): Promise<ElementHandle<Element> | null> {
  return (await page.$(`[data-explicame-id="${id.replace(/"/g, "")}"]`)) as ElementHandle<Element> | null;
}

export async function resolveHandle(page: Page, strategies: Strategy[], timeoutMs = 5000): Promise<ElementHandle<Element> | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const handle = await page.evaluateHandle((s) => window.__explicame!.resolve(s), strategies);
    const element = handle.asElement();
    if (element) return element as ElementHandle<Element>;
    await handle.dispose();
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(200);
  }
}

/** `baseUrl` is the app's URL: navigate paths resolve against it, never against wherever the page happens to be. */
export async function performAction(page: Page, element: ElementHandle<Element> | null, action: Action, baseUrl?: string): Promise<void> {
  if (action.type === "navigate") {
    await page.goto(new URL(action.url, baseUrl ?? page.url()).toString(), { waitUntil: "domcontentloaded" });
  } else {
    if (!element) throw new Error(`the ${action.type} action needs an element`);
    if (action.type === "click") await element.click({ timeout: 5000 });
    else if (action.type === "type") await element.fill(action.value, { timeout: 5000 });
    else await element.selectOption({ label: action.value }, { timeout: 5000 });
  }
  await settle(page);
}
