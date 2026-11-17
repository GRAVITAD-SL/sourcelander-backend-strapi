const { hybridScraper } = require("../dist/src/services/scraper/hybrid-scraper.js");

(async () => {
  try {
    const r = await hybridScraper.extractWithAI(
      "https://hubstafftalent.net/search/profiles?search%5Bkeywords%5D=react",
      "Extract all freelancer profiles from the search results. For each one get: name, title, description, profileUrl (the exact href of the profile link, never a node id), avatar (the exact src of the avatar image), country, hourly rate, and all listed skills.",
      "div.content-section",
      "div.search-result"
    );
    console.log("AI RESULTS:", r.length);
    for (const f of r) {
      console.log("-", f.name, "|", (f.profileUrl || "SIN URL"), "|", f.hourlyRate ?? "");
    }
  } catch (e) {
    console.log("AI ERROR:", e.message.slice(0, 300));
  } finally {
    await hybridScraper.close();
  }
})();
