/**
 * Regenerates the PWA icon set from public/icons/icon-source.svg.
 *
 * Uses the Chromium already available in this environment to rasterize the
 * SVG at each required size, rather than adding an image-processing
 * dependency for one script that runs rarely.
 *
 *   node scripts/render-icons.mjs
 *
 * Edit icon-source.svg (it already has padding baked in around the glyph, so
 * the same file works as both a normal and a maskable icon) and re-run this
 * after any change.
 */
// Needs the `playwright` package, which this repo does not otherwise depend
// on (the app itself ships zero image-processing dependencies). Either
// `npm install --no-save playwright` first, or run this in an environment
// that already provides one.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "public", "icons");
const svg = readFileSync(join(iconsDir, "icon-source.svg"), "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent}
  svg{display:block}
</style></head><body>${svg}</body></html>`;

const sizes = [
  { name: "icon-512.png", px: 512 },
  { name: "icon-192.png", px: 192 },
  { name: "apple-touch-icon.png", px: 180 },
  { name: "favicon-32.png", px: 32 },
  { name: "favicon-16.png", px: 16 },
];

const browser = await chromium.launch();
for (const { name, px } of sizes) {
  const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate((size) => {
    const svgEl = document.querySelector("svg");
    svgEl.setAttribute("width", String(size));
    svgEl.setAttribute("height", String(size));
  }, px);
  await page.locator("svg").screenshot({ path: join(iconsDir, name) });
  await page.close();
  console.log(`wrote public/icons/${name} (${px}x${px})`);
}
await browser.close();
