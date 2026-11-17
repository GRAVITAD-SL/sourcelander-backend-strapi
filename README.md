# Sourcelander Backend

API del marketplace Sourcelander, construida con **Strapi 5.62** + **Postgres 17** (en Docker), con **scraper híbrido** de freelancers (Workana / Hubstaff) impulsado por Playwright + IA (Stagehand/Groq como fallback).

## Requisitos

- Node.js **22.x**
- Docker Desktop (para la DB)
- Chromium de Playwright para el scraper en el host: `npx playwright install chromium`

## Arranque local

**Opción A — DB en Docker + Strapi en host (recomendada para iterar el scraper):**

```bash
docker compose up -d strapiDB      # Postgres 17 (publica 5432)
npx playwright install chromium    # solo la primera vez

# PowerShell:
$env:DATABASE_HOST="localhost"; npm run develop   # http://localhost:1337
```

**Opción B — todo en Docker:**

```bash
docker compose up -d --build       # imagen con Chromium de Alpine incluido
```

### `.env`

Generar secretos con `node ../genEnv.js` (desde la raíz del monorepo) y completar:

```env
HOST=0.0.0.0
PORT=1337
NODE_ENV=production
APP_KEYS=...
API_TOKEN_SALT=...
ADMIN_JWT_SECRET=...
TRANSFER_TOKEN_SALT=...
JWT_SECRET=...
ENCRYPTION_KEY=...
DATABASE_CLIENT=postgres
DATABASE_HOST=strapiDB          # localhost en la opción A
DATABASE_PORT=5432
DATABASE_NAME=sourcelander
DATABASE_USERNAME=strapi
DATABASE_PASSWORD=...
DATABASE_SSL=false
GROQ_API_KEY=...
STAGEHAND_MODEL_NAME=groq/openai/gpt-oss-120b
STAGEHAND_HEADLESS=true
ENABLE_INITIAL_SCRAPER=false
ENABLE_SCRAPER_CRON=true        # cron semanal (lunes 6:00) de scraping
```

> Primer arranque con DB fresca: crear el superadmin desde `/admin`.

## Scraper híbrido (`src/services/scraper/hybrid-scraper.ts`)

1. **Primario:** extracción determinista con Playwright + selectores específicos por sitio
   (Workana: `article.js-worker`; Hubstaff: `div.search-result`). Gratis e instantáneo.
2. **Fallback IA:** si los selectores no devuelven nada (markup cambiado), Stagehand extrae con
   IA vía Groq (`zod` schema tolerante + trim del DOM a 6 cards para caber en el free tier).
   El LLM puede ser inconsistente — es aceptable para un fallback.

Variables: `GROQ_API_KEY`, `STAGEHAND_MODEL_NAME` (formato `provider/modelo` de Stagehand 3),
`STAGEHAND_HEADLESS`, `CHROMIUM_EXECUTABLE_PATH` (solo Docker/Alpine: `/usr/bin/chromium-browser`;
en el host Playwright usa su propio Chromium). Probar el fallback directo: `node scripts/test-ai-fallback.cjs`.

## Endpoints principales

| Ruta                                    | Descripción                                                        |
| --------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/search/freelancers?query=`    | Búsqueda principal (pública; dispara scraping si no hay caché 24h) |
| `GET /api/freelancers/search?query=`    | Búsqueda sobre caché (pública)                                     |
| `GET /api/scraper-test?query=&source=`  | Prueba del scraper (1 página; solo dev)                            |
| `POST /api/email/send` / `send-bulk`    | Emails (protegidos por auth default)                               |
| `/api/categories`, `/api/articles`, ... | Content-types estándar de Strapi                                   |

El search cachea resultados en `cached_freelancers` con TTL de 24h y `source` (workana/hubstaff).

## Docker / Producción (Dokploy)

- Servicio **Backend** (compose) → repo `GRAVITAD-SL/sourcelander-backend-strapi`, rama `main`.
- Dockerfile: `node:22-alpine` + Chromium de Alpine (`CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser`).
- Puertos del host configurables vía `STRAPI_PUBLISH_PORT` / `DB_PUBLISH_PORT` (el dominio enruta por
  Traefik al puerto interno; la publicación es solo para acceso directo).
- Postgres 17 con volumen nombrado (`strapiDBData`) — la DB de producción arrancó fresca.
- Variables en el tab Environment del servicio (Dokploy las inyecta como `.env` del compose).
- Flujo: todo a `dev` → PR `dev → main` → merge → re-despliegue de producción.

## Estructura

```
src/
├── api/                    # content-types: freelancer, cached-freelancer, category,
│   #                         article, author, email, home, global, search, scraper-test
├── services/scraper/       # hybrid-scraper.ts
├── config/                 # cron-tasks.ts (scraping semanal), database, middlewares
└── index.ts                # bootstrap (scraping inicial, deshabilitado por defecto)
```

## Notas

- `zod` se mantiene en **v3** (lo exige Stagehand). `react-router-dom` v6 y `styled-components` v6 son peer deps del admin de Strapi 5.
- Antes de subir una versión de Strapi, revisar release notes de minors.
