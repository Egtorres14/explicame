import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { t } from "@explicame/core";
import { sessionPath } from "./build.js";
import type { Config } from "./config.js";
import { explicameHome } from "./credentials.js";

/** Opens a visible browser at the app; when the user closes the tab, the session is saved outside the project. */
export async function login(o: { cwd: string; config: Config; home?: string; log: (message: string) => void }): Promise<string> {
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(new URL(o.config.startUrl, o.config.appUrl).toString());
    o.log(t(o.config.uiLanguage, "login.instructions"));
    await page.waitForEvent("close", { timeout: 0 });
    const file = sessionPath(o.home ?? explicameHome(), o.cwd);
    await mkdir(dirname(file), { recursive: true });
    await context.storageState({ path: file });
    o.log(t(o.config.uiLanguage, "login.saved", { path: file }));
    return file;
  } finally {
    await browser.close();
  }
}
