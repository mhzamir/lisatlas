# LIS Atlas

Worldwide library and information science research monitor built on OpenAlex. Topic selector, scope (LIS only or all disciplines), country filter, publications per year, top countries, journal and title word clouds, top keywords, open access status, three tables per topic, and exports to CSV, Excel, RIS and GEXF (keyword, co-author and country collaboration networks).

## Files
- `index.html`: page layout and styles
- `app.js`: topics, countries, queries, charts, tables, exports
- `netlify/functions/openalex.js`: serverless function that calls OpenAlex with your private key
- `netlify.toml`: tells Netlify where the site and function are

## Required setting
OpenAlex requires a free API key. Add it in Netlify as the environment variable `OPENALEX_API_KEY`. Optional: `OPENALEX_EMAIL`.

## Customize
- Topics: edit `TOPICS` in `app.js`. Use quotes for phrases and OR / AND / NOT in capitals.
- Countries: edit `COUNTRIES` in `app.js` (two-letter codes).
- LIS scope uses OpenAlex subfield 3309 (Library and Information Sciences).
