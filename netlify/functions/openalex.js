// Netlify serverless function: proxies the OpenAlex /works API.
// Keeps your OpenAlex API key private.
// Set OPENALEX_API_KEY (required) and OPENALEX_EMAIL (optional) in
// Netlify > Site configuration > Environment variables.

const BASE = "https://api.openalex.org/works";
const ALLOWED = ["filter", "search", "sort", "per_page", "page", "select", "group_by"];

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  try {
    const body = JSON.parse(event.body || "{}");
    const p = new URLSearchParams();
    for (const k of ALLOWED) {
      if (body[k] !== undefined && body[k] !== "") p.set(k, String(body[k]).slice(0, 3000));
    }
    if (process.env.OPENALEX_API_KEY) p.set("api_key", process.env.OPENALEX_API_KEY);
    if (process.env.OPENALEX_EMAIL) p.set("mailto", process.env.OPENALEX_EMAIL);

    const res = await fetch(`${BASE}?${p}`);
    const text = await res.text();
    if (!res.ok) {
      let msg = `OpenAlex error ${res.status}`;
      try { msg = JSON.parse(text).message || JSON.parse(text).error || msg; } catch (_) {}
      if (res.status === 429 && !process.env.OPENALEX_API_KEY) {
        msg = "No OpenAlex API key is set. Add OPENALEX_API_KEY in Netlify environment variables and redeploy.";
      }
      return { statusCode: res.status, headers, body: JSON.stringify({ error: msg }) };
    }
    return { statusCode: 200, headers, body: text };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
