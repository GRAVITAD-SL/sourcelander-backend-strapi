import { hybridScraper } from "../../../services/scraper/hybrid-scraper";

export default {
  async test(ctx) {
    try {
      const { query = "javascript", source = "workana" } = ctx.query;

      ctx.body = {
        status: "starting",
        message: `Testing ${source} scraper with query: ${query}`,
      };

      let results;
      if (source === "workana") {
        results = await hybridScraper.scrapeWorkana(query, 1);
      } else {
        results = await hybridScraper.scrapeHubstaff(query, 1);
      }

      await hybridScraper.close();

      ctx.body = {
        status: "success",
        source,
        query,
        resultsCount: results.length,
        results: results.slice(0, 3), // Solo primeros 3 para no saturar
      };
    } catch (error) {
      ctx.body = {
        status: "error",
        message: error.message,
        stack: error.stack,
      };
      ctx.status = 500;
    }
  },
};
