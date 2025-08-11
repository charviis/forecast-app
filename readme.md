Usage

To use the app, simply enter a city name in the input field and click the "Search" button. The weather information for that city will be displayed on the page.

## Finance Site (Standalone)

A smaller standalone finance dashboard lives under `finance-site/` with its own Express server.

Run it:

1. Copy `finance-site/server/.env.example` to `finance-site/server/.env` and set `YF_API_KEY` (RapidAPI Yahoo Finance key).
2. Install dependencies and start:

```bash
cd finance-site/server
npm install
npm start
```

Open <http://localhost:5005> in the browser.

If the RapidAPI key lacks a subscription or returns 403, the server now falls back to public Yahoo endpoints for quotes & charts (search/news may be limited).
