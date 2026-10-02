// Real screenshots for the video and the README: the panel and the demo app with its guide button.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const assets = fileURLToPath(new URL("./assets/", import.meta.url));
const images = `${root}docs/images/`;
mkdirSync(assets, { recursive: true });
mkdirSync(images, { recursive: true });

function startPanel() {
  const child = spawn(process.execPath, [`${root}packages/cli/dist/bin.js`, "panel", "--no-open", "--port", "0"], {
    cwd: `${root}examples/demo-app`,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk.toString();
      const match = /(http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/.exec(text);
      if (match) resolve({ url: match[1], stop: () => child.kill() });
    });
    child.on("exit", () => reject(new Error(`the panel exited: ${text}`)));
  });
}

const panel = await startPanel();
const browser = await chromium.launch();
try {
  for (const lang of ["es", "en"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", deviceScaleFactor: 1.5 });
    await page.goto(panel.url);
    await page.getByRole("button", { name: lang.toUpperCase(), exact: true }).click();
    // The voice card, which the narration talks about at that moment: its heading, provider and voices, below the
    // sticky header.
    const card = page.locator("#voice");
    await card.evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 90));
    const box = await card.boundingBox();
    await page.screenshot({ path: `${assets}panel.${lang}.png`, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 440) } });
    await page.close();
  }
  const light = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  await light.goto(panel.url);
  await light.screenshot({ path: `${images}panel.png` });
  await light.close();
} finally {
  await browser.close();
  panel.stop();
}
console.log("shots ready: video/assets/panel.{es,en}.png, docs/images/panel.png");
