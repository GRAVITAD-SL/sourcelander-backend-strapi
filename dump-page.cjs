const { chromium } = require("playwright");

(async () => {
  const url = process.argv[2] || "https://hubstafftalent.net/search/profiles?search%5Bkeywords%5D=react%20developer";
  const out = process.argv[3] || "rendered.html";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const html = await page.content();
  require("fs").writeFileSync(out, html);
  console.log("SAVED", out, html.length);
  await browser.close();
})();
