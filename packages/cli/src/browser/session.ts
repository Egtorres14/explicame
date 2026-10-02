import { existsSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { DOM_RUNTIME, isRequestAllowed, t, type AllowRule, type Lang } from "@explicame/core";

export interface BlockedRequest {
  method: string;
  url: string;
}

export interface SessionOptions {
  appUrl: string;
  startUrl: string;
  storageStatePath?: string;
  allowRequests?: AllowRule[];
  headless?: boolean;
  lang?: Lang;
  viewport?: { width: number; height: number };
  /** Folder where Playwright writes the video of the page (recording). */
  recordVideoDir?: string;
  launchArgs?: string[];
  /** Runs on the context before any route or page exists (bindings, extra routes). */
  beforePage?: (context: BrowserContext) => Promise<void>;
}

export interface Session {
  appUrl: string;
  startUrl: string;
  /** True while the page is still on the app's origin. */
  inApp(): boolean;
  /** When the page was created, which is when its video starts. */
  createdAt: number;
  page: Page;
  context: BrowserContext;
  blocked: BlockedRequest[];
  goto(path: string): Promise<void>;
  close(): Promise<void>;
}

export class AppUnreachableError extends Error {
  constructor(url: string, lang: Lang = "es") {
    super(t(lang, "app.unreachable", { url }));
    this.name = "AppUnreachableError";
  }
}

export async function settle(page: Page, timeoutMs = 3000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(150);
}

export async function openSession(o: SessionOptions): Promise<Session> {
  const browser = await chromium.launch({ headless: o.headless ?? true, args: o.launchArgs });
  try {
    const storageState = o.storageStatePath && existsSync(o.storageStatePath) ? o.storageStatePath : undefined;
    const viewport = o.viewport ?? { width: 1280, height: 800 };
    const context = await browser.newContext({
      viewport,
      storageState,
      recordVideo: o.recordVideoDir ? { dir: o.recordVideoDir, size: viewport } : undefined,
    });
    await o.beforePage?.(context);
    const blocked: BlockedRequest[] = [];
    await context.route("**/*", (route) => {
      const request = route.request();
      // fallback (not continue): lets routes registered earlier, like the recorder's, serve the request first.
      if (isRequestAllowed(request.method(), request.url(), o.allowRequests)) return route.fallback();
      blocked.push({ method: request.method(), url: request.url() });
      return route.abort("blockedbyclient");
    });
    await context.addInitScript(DOM_RUNTIME);
    const page = await context.newPage();
    const createdAt = Date.now();
    const goto = async (path: string) => {
      const url = new URL(path, o.appUrl).toString();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      } catch {
        throw new AppUnreachableError(url, o.lang);
      }
      await settle(page);
    };
    await goto(o.startUrl);
    const appOrigin = new URL(o.appUrl).origin;
    const inApp = () => {
      try {
        return new URL(page.url()).origin === appOrigin;
      } catch {
        return false;
      }
    };
    return {
      appUrl: o.appUrl,
      startUrl: o.startUrl,
      inApp,
      createdAt,
      page,
      context,
      blocked,
      goto,
      close: async () => {
        await context.close();
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
