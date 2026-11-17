import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand" with { "resolution-mode": "import" };

/**
 * Scraper híbrido de freelancers (Workana / Hubstaff).
 *
 * Estrategia:
 *  1. Extracción determinista con Playwright + selectores específicos de cada
 *     sitio (rápida, gratuita y suficiente en la mayoría de las corridas).
 *  2. Fallback a Stagehand (IA + Zod vía Groq) solo cuando los selectores
 *     no devuelven nada — típicamente porque la web cambió su markup.
 */

const FreelancerSchema = z.object({
  sourceId: z.string(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  profileUrl: z.string(),
  avatar: z.string().optional(),
  country: z.string().optional(),
  hourlyRate: z.number().optional(),
  rating: z.number().optional(),
  projectsCompleted: z.number().optional(),
  skills: z.array(z.string()),
});

export type ScrapedFreelancer = z.infer<typeof FreelancerSchema> & {
  source?: string;
};

type RawCard = {
  name: string;
  title: string;
  description: string;
  profileUrl: string;
  avatar: string;
  country: string;
  rate: string;
  rating: string;
  projects: string;
  skills: string[];
};

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, " ").trim() || "";

/**
 * Schema tolerante para el fallback IA: los LLM a veces omiten campos en
 * alguna fila, y un único item inválido descartaría todo el extract.
 * La limpieza (nombre + profileUrl) se hace después de la extracción.
 */
const AISchema = z.object({
  sourceId: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  profileUrl: z.string().optional(),
  avatar: z.string().optional(),
  country: z.string().optional(),
  hourlyRate: z.coerce.number().optional(),
  rating: z.coerce.number().optional(),
  projectsCompleted: z.coerce.number().optional(),
  skills: z.array(z.string()).optional(),
});

/** Extrae el primer número de un texto tipo "USD 25,00" o "$10/hr". */
function parseRate(raw: string): number | undefined {
  if (!raw) return undefined;
  let cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return undefined;
  // formato "1.250,50" (es) o "1,250.50" (en)
  if (/,\d{2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const value = parseFloat(cleaned);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalize(raw: RawCard, baseUrl: string): ScrapedFreelancer {
  let profileUrl = raw.profileUrl;
  try {
    profileUrl = new URL(raw.profileUrl, baseUrl).toString();
  } catch {
    /* se deja el href tal cual */
  }

  let sourceId = "";
  try {
    const parts = new URL(profileUrl).pathname.split("/").filter(Boolean);
    sourceId = parts[parts.length - 1] || profileUrl;
  } catch {
    sourceId = profileUrl;
  }

  let avatar = raw.avatar;
  if (avatar && avatar.startsWith("//")) avatar = `https:${avatar}`;

  const ratingValue = raw.rating.match(/([\d.,]+)\s*de\b/)?.[1];

  return {
    sourceId,
    name: raw.name,
    title: raw.title || undefined,
    description: raw.description || undefined,
    profileUrl,
    avatar: avatar || undefined,
    country: raw.country || undefined,
    hourlyRate: parseRate(raw.rate),
    rating: ratingValue ? parseRate(ratingValue) : undefined,
    projectsCompleted: raw.projects
      ? parseInt(raw.projects.replace(/[.,]/g, ""), 10) || undefined
      : undefined,
    skills: raw.skills.filter((s) => s && !/^\+\d+$/.test(s)),
  };
}

async function extractWorkanaHeuristics(page: Page): Promise<RawCard[]> {
  await page
    .waitForSelector("article.js-worker", { timeout: 20_000 })
    .catch(() => {});

  return page.evaluate(() => {
    const pick = (el: Element | null | undefined) =>
      el?.textContent?.replace(/\s+/g, " ").trim() || "";

    const cards: {
      name: string;
      title: string;
      description: string;
      profileUrl: string;
      avatar: string;
      country: string;
      rate: string;
      rating: string;
      projects: string;
      skills: string[];
    }[] = [];

    for (const article of document.querySelectorAll("article.js-worker")) {
      const link = article.querySelector<HTMLAnchorElement>(
        "a[href*='/freelancer/']",
      );
      if (!link) continue;

      const href = link.getAttribute("href") || "";
      const name =
        pick(article.querySelector("[itemprop='name']")) ||
        pick(article.querySelector(".user-name a"));
      if (!name) continue;

      const avatar = article
        .querySelector<HTMLImageElement>(".profile-photo img")
        ?.getAttribute("src") || "";
      const title = pick(article.querySelector(".role-tagline"));
      const description =
        pick(
          article.querySelector(
            ".worker-description .text-expander-content span",
          ),
        ) || pick(article.querySelector(".worker-description"));
      const rate = pick(article.querySelector(".price"));
      const country =
        pick(article.querySelector(".country .country-name")) ||
        article.querySelector(".flag")?.getAttribute("title") ||
        "";
      const rating = article
        .querySelector(".profile-stars .stars-bg")
        ?.getAttribute("title") || "";
      const projMatch = pick(article).match(/Proyectos completados:\s*(\d+)/);
      const skills = Array.from(
        article.querySelectorAll(".main-skills .skill"),
      )
        .map((el) => pick(el).replace(/\s*\(\d+.*\)\s*$/, ""))
        .filter(Boolean)
        .slice(0, 15);

      cards.push({
        name,
        title,
        description,
        profileUrl: href,
        avatar,
        country,
        rate,
        rating,
        projects: projMatch ? projMatch[1] : "",
        skills,
      });
    }

    return cards;
  });
}

async function extractHubstaffHeuristics(page: Page): Promise<RawCard[]> {
  await page
    .waitForSelector("div.search-result", { timeout: 20_000 })
    .catch(() => {});

  return page.evaluate(() => {
    const pick = (el: Element | null | undefined) =>
      el?.textContent?.replace(/\s+/g, " ").trim() || "";

    const cards: {
      name: string;
      title: string;
      description: string;
      profileUrl: string;
      avatar: string;
      country: string;
      rate: string;
      rating: string;
      projects: string;
      skills: string[];
    }[] = [];

    for (const card of document.querySelectorAll("div.search-result")) {
      const link = card.querySelector<HTMLAnchorElement>(
        "a.name[href*='/profiles/']",
      );
      if (!link) continue;

      const href = link.getAttribute("href") || "";
      const name = pick(link);
      if (!name) continue;

      const avatar = card
        .querySelector<HTMLImageElement>(".avatar img")
        ?.getAttribute("src") || "";
      const title = pick(card.querySelector(".speciality"));
      const description = pick(card.querySelector(".profil-bio"));
      const rate = pick(card.querySelector(".pay-rate"));
      const country = pick(card.querySelector(".location"));
      const skills = Array.from(card.querySelectorAll(".tag"))
        .map((el) => pick(el))
        .filter(Boolean)
        .slice(0, 15);

      cards.push({
        name,
        title,
        description,
        profileUrl: href,
        avatar,
        country,
        rate,
        rating: "",
        projects: "",
        skills,
      });
    }

    return cards;
  });
}

class HybridScraperService {
  private browser: Browser | null = null;
  private stagehand: Stagehand | null = null;

  private isHeadless(): boolean {
    const headlessEnv = process.env.STAGEHAND_HEADLESS;
    return headlessEnv === undefined
      ? true
      : !["false", "0", "no"].includes(headlessEnv.toLowerCase());
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.launch({ headless: this.isHeadless() });
    return this.browser;
  }

  private async newPage(url: string): Promise<Page> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 900 },
      locale: "en-US",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    return page;
  }

  /**
   * Fallback IA: solo se inicializa Stagehand si los selectores fallaron.
   */
  private async extractWithAI(
    url: string,
    instruction: string,
    selector?: string,
    cardSelector?: string,
  ) {
    if (!this.stagehand) {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error(
          "GROQ_API_KEY no está configurada en las variables de entorno",
        );
      }

      // Stagehand 3.x es ESM-only: se importa dinámicamente desde CommonJS.
      const { Stagehand: StagehandClient } = await import(
        "@browserbasehq/stagehand"
      );

      this.stagehand = new StagehandClient({
        env: "LOCAL",
        localBrowserLaunchOptions: { headless: this.isHeadless() },
        model: {
          modelName:
            process.env.STAGEHAND_MODEL_NAME || "openai/gpt-oss-120b",
          apiKey,
        },
      });
      await this.stagehand.init();
    }

    const page = this.stagehand.context.pages()[0];
    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 45_000 });

    // Recorta el DOM para que el snapshot de accesibilidad quepa en los
    // límites de tokens del tier gratuito de Groq (~8k TPM).
    await page.evaluate(() => {
      document
        .querySelectorAll("script, style, aside, footer, nav, iframe")
        .forEach((el) => el.remove());
    });
    if (cardSelector) {
      const kept = await page.evaluate((sel: string) => {
        const cards = Array.from(document.querySelectorAll(sel));
        const removed = cards.slice(6).length;
        cards.slice(6).forEach((c) => c.remove());
        return { total: cards.length, removed };
      }, cardSelector);
      console.log(
        `✂️  Trim IA: quedan ${kept.total - kept.removed}/${kept.total} cards`,
      );
    }

    const freelancers = await this.stagehand.extract(
      instruction,
      z.array(AISchema) as never,
      // selector acota el snapshot de accesibilidad: evita pasarse los límites
      // de tokens del tier gratuito de Groq con páginas muy largas.
      { page, ...(selector ? { selector } : {}) },
    );

    const cleaned: ScrapedFreelancer[] = [];
    for (const f of freelancers as Partial<ScrapedFreelancer>[]) {
      let profileUrl = f.profileUrl || "";
      if (profileUrl && !/^https?:\/\//.test(profileUrl)) {
        try {
          profileUrl = new URL(profileUrl, url).toString();
        } catch {
          continue;
        }
      }
      if (!f.name || !/^https?:\/\//.test(profileUrl)) continue;
      cleaned.push({ ...f, name: f.name, profileUrl } as ScrapedFreelancer);
    }
    return cleaned;
  }

  async scrapeWorkana(
    query: string,
    maxPages = 1,
  ): Promise<ScrapedFreelancer[]> {
    const results: ScrapedFreelancer[] = [];

    for (let i = 1; i <= maxPages; i++) {
      const url = `https://www.workana.com/freelancers?query=${encodeURIComponent(query)}&page=${i}`;
      const page = await this.newPage(url);
      try {
        let raw = await extractWorkanaHeuristics(page);

        if (raw.length === 0) {
          console.log(
            `♻️  Selectores sin resultados en Workana (página ${i}), usando fallback IA...`,
          );
          const ai = await this.extractWithAI(
            url,
            "Extract all freelancer profiles from the list, including their name, title, description, profile URL, avatar image source, country, hourly rate, and skills tags.",
            "#workers",
            "article.js-worker",
          );
          results.push(...ai);
          continue;
        }

        results.push(
          ...raw
            .filter((c) => c.name && c.profileUrl)
            .map((c) => normalize(c, "https://www.workana.com")),
        );
      } finally {
        await page.context().close();
      }
    }

    return results;
  }

  async scrapeHubstaff(
    query: string,
    maxPages = 1,
  ): Promise<ScrapedFreelancer[]> {
    const results: ScrapedFreelancer[] = [];

    for (let i = 1; i <= maxPages; i++) {
      const url = `https://hubstafftalent.net/search/profiles?search%5Bkeywords%5D=${encodeURIComponent(query)}&page=${i}`;
      const page = await this.newPage(url);
      try {
        let raw = await extractHubstaffHeuristics(page);

        if (raw.length === 0) {
          console.log(
            `♻️  Selectores sin resultados en Hubstaff (página ${i}), usando fallback IA...`,
          );
          const ai = await this.extractWithAI(
            url,
            "Extract all freelancer profiles from the search results. For each one get: name, title, description, profileUrl (the exact href of the profile link, never a node id), avatar (the exact src of the avatar image), country, hourly rate, and all listed skills.",
            "div.content-section",
            "div.search-result",
          );
          results.push(...ai);
          continue;
        }

        results.push(
          ...raw
            .filter((c) => c.name && c.profileUrl)
            .map((c) => normalize(c, "https://hubstafftalent.net")),
        );
      } finally {
        await page.context().close();
      }
    }

    return results;
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    if (this.stagehand) {
      await this.stagehand.close().catch(() => {});
      this.stagehand = null;
    }
  }
}

export const hybridScraper = new HybridScraperService();
