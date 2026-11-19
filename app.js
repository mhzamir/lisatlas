// LIS Atlas front end. Edit TOPICS, COUNTRIES and CATEGORIES to change what the app tracks.
const API_URL = "/.netlify/functions/openalex";
const LIS_SUBFIELD = "3309"; // OpenAlex subfield: Library and Information Sciences

// OpenAlex search supports quotes and AND / OR / NOT (in capitals). Empty = everything in scope.
const TOPICS = {
  "All LIS research (overview)": "",
  "AI & generative AI in libraries": '"artificial intelligence" OR "generative AI" OR ChatGPT OR "large language model"',
  "Information literacy & AI literacy": '"information literacy" OR "AI literacy" OR "media literacy" OR "digital literacy"',
  "Misinformation & fact-checking": 'misinformation OR disinformation OR "fake news" OR "fact-checking" OR infodemic',
  "Digital libraries & repositories": '"digital library" OR "digital libraries" OR "institutional repository" OR digitization OR "digital preservation"',
  "Open access & scholarly communication": '"open access" OR "open science" OR "scholarly communication" OR "predatory journals"',
  "Academic libraries": '"academic library" OR "academic libraries" OR "university library" OR "university libraries"',
  "Public libraries & communities": '"public library" OR "public libraries" OR "community engagement" OR "library services"',
  "Research data management & data literacy": '"research data management" OR "data literacy" OR "data curation" OR "FAIR data"',
  "Information behavior & seeking": '"information behavior" OR "information behaviour" OR "information seeking" OR "information needs"',
  "Bibliometrics & scientometrics": 'bibliometric OR scientometric OR "citation analysis" OR altmetrics',
  "Privacy, cybersecurity & libraries": 'privacy OR cybersecurity OR "data protection" OR surveillance',
};

const COUNTRIES = ["", "US", "GB", "CA", "AU", "IN", "BD", "PK", "LK", "NP", "NG", "GH", "KE", "ZA", "EG", "SA", "AE", "TR", "IR", "CN", "JP", "KR", "ID", "MY", "PH", "BR", "MX", "AR", "CO", "ES", "PT", "DE", "FR", "IT", "NL", "SE", "PL"];

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// Each topic is split into these tables.
const CATEGORIES = [
  { key: "latest", label: "Latest (last 30 days)", filters: () => [`from_publication_date:${daysAgo(30)}`] },
  { key: "cited", label: "Most cited (last 5 years)", filters: () => [`from_publication_date:${daysAgo(365 * 5)}`], sort: "cited_by_count:desc" },
  { key: "oa", label: "Open access (last 5 years)", filters: () => [`from_publication_date:${daysAgo(365 * 5)}`, "open_access.is_oa:true"] },
];

const SELECT = "id,doi,display_name,publication_year,publication_date,authorships,primary_location,open_access,cited_by_count,type,keywords,abstract_inverted_index";

const STOP = new Set(("a an and are as at be between by can de del do during for from has have how in into is it its la los of on or our study the their this to toward towards using use versus vs was were what when which with within without among across based after analysis case evaluation effect effects impact role new results than through over under via who whom why will may not more most associated assessment approach factors en el y et des du le les und der die das").split(" "));

const $ = (id) => document.getElementById(id);
const state = { results: {}, active: null, charts: {}, groups: {} };
let regionNames;
try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch (_) { regionNames = null; }
const countryName = (c) => (regionNames && c ? regionNames.of(c) : c);

// ---------- setup ----------
function init() {
  Object.keys(TOPICS).forEach((t) => $("topic").add(new Option(t, t)));
  COUNTRIES.forEach((c) => $("country").add(new Option(c ? countryName(c) : "Worldwide", c)));
  $("searchBtn").onclick = runSearch;
  $("refreshBtn").onclick = runSearch;
  $("resetBtn").onclick = reset;
  $("filter").oninput = renderTable;
  document.querySelectorAll("[data-export]").forEach((b) => (b.onclick = () => exportData(b.dataset.export)));
}

function setStatus(msg, isError = false) {
  $("status").textContent = msg;
  $("status").className = "status" + (isError ? " error" : "");
}

// ---------- data ----------
function baseFilters() {
  const f = ["is_retracted:false", "type:article|review"];
  if ($("scope").value === "lis") f.push(`primary_topic.subfield.id:${LIS_SUBFIELD}`);
  if ($("country").value) f.push(`authorships.countries:${$("country").value}`);
  return f;
}

async function callApi(params) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  let data;
  try { data = await res.json(); } catch (_) { throw new Error(`Server returned no data (HTTP ${res.status}). Check that the netlify folder is at the top level of your repository.`); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function rebuildAbstract(inv) {
  if (!inv) return "";
  const words = [];
  Object.entries(inv).forEach(([w, positions]) => positions.forEach((p) => (words[p] = w)));
  return words.filter(Boolean).join(" ");
}

function parseWork(w) {
  const countries = [...new Set((w.authorships || []).flatMap((a) => a.countries || []))];
  const institutions = [...new Set((w.authorships || []).flatMap((a) => (a.institutions || []).map((i) => i.display_name)).filter(Boolean))];
  return {
    id: (w.id || "").replace("https://openalex.org/", ""),
    title: w.display_name || "(untitled)",
    authors: (w.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean),
    countries,
    institutions,
    source: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "",
    year: w.publication_year || "",
    date: w.publication_date || "",
    cited: w.cited_by_count || 0,
    type: w.type || "",
    doi: (w.doi || "").replace("https://doi.org/", ""),
    oaStatus: (w.open_access && w.open_access.oa_status) || "closed",
    oaUrl: (w.open_access && w.open_access.oa_url) || "",
    keywords: (w.keywords || []).map((k) => k.display_name).filter(Boolean),
    abstract: rebuildAbstract(w.abstract_inverted_index),
  };
}

async function runSearch() {
  const topic = $("topic").value;
  const search = TOPICS[topic];
  const perPage = $("perpage").value;
  let sort = $("sort").value;
  if (sort === "relevance_score:desc" && !search) sort = "publication_date:desc"; // relevance needs a search term
  $("searchBtn").disabled = $("refreshBtn").disabled = true;
  state.results = {}; state.groups = {};
  try {
    for (const cat of CATEGORIES) {
      setStatus(`Fetching "${cat.label}" from OpenAlex...`);
      const data = await callApi({
        filter: [...baseFilters(), ...cat.filters()].join(","),
        search, sort: cat.sort || sort, per_page: perPage, select: SELECT,
      });
      state.results[cat.key] = { count: data.meta ? data.meta.count : 0, articles: (data.results || []).map(parseWork) };
    }
    setStatus("Fetching trends and country counts...");
    const tenYears = [...baseFilters(), `from_publication_date:${new Date().getFullYear() - 10}-01-01`].join(",");
    state.groups.years = (await callApi({ filter: tenYears, search, group_by: "publication_year" })).group_by || [];
    const fiveYears = [...baseFilters(), `from_publication_date:${daysAgo(365 * 5)}`].join(",");
    state.groups.countries = (await callApi({ filter: fiveYears, search, group_by: "authorships.countries" })).group_by || [];

    state.active = state.active && state.results[state.active] ? state.active : CATEGORIES[0].key;
    const n = allArticles().length;
    const where = $("country").value ? countryName($("country").value) : "worldwide";
    setStatus(n ? `Loaded ${n} unique works for "${topic}" (${where}).` : "No works found. Try another topic, scope or country.");
    $("updated").textContent = new Date().toLocaleString();
    renderAll();
  } catch (e) {
    setStatus("Error: " + e.message, true);
  } finally {
    $("searchBtn").disabled = $("refreshBtn").disabled = false;
  }
}

function allArticles() {
  const seen = new Map();
  Object.values(state.results).forEach((r) => r.articles.forEach((a) => seen.set(a.id, a)));
  return [...seen.values()];
}

function activeArticles() {
  const r = state.results[state.active];
  if (!r) return [];
  const q = $("filter").value.trim().toLowerCase();
  if (!q) return r.articles;
  return r.articles.filter((a) =>
    [a.title, a.authors.join(" "), a.source, a.countries.map(countryName).join(" "), a.keywords.join(" "), a.institutions.join(" ")]
      .join(" ").toLowerCase().includes(q));
}

// ---------- rendering ----------
function countBy(items) {
  const m = new Map();
  items.forEach((x) => x && m.set(x, (m.get(x) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function renderAll() {
  const all = allArticles();
  $("stats").innerHTML = CATEGORIES.map((c) => {
    const r = state.results[c.key];
    return `<div class="stat"><b>${r ? r.count.toLocaleString() : 0}</b><span>${c.label}<br>total in OpenAlex</span></div>`;
  }).join("");

  const years = (state.groups.years || []).map((g) => [String(g.key), g.count])
    .filter(([y]) => /^\d{4}$/.test(y)).sort((a, b) => a[0] - b[0]);
  drawChart("yearChart", "line", years, "#6b3fa0", false);

  const ctry = (state.groups.countries || []).filter((g) => g.key && g.key !== "unknown")
    .slice(0, 15).map((g) => [g.key_display_name || g.key, g.count]);
  drawChart("countryChart", "bar", ctry, "#6b3fa0", true);

  drawCloud("journalCloud", countBy(all.map((a) => a.source)).slice(0, 60));
  const words = [];
  all.forEach((a) => a.title.toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9\- ]/g, " ").split(/\s+/)
    .forEach((w) => { if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) words.push(w); }));
  drawCloud("wordCloud", countBy(words).slice(0, 120));
  drawChart("keywordChart", "bar", countBy(all.flatMap((a) => a.keywords)).slice(0, 15), "#0f7b6c", true);
  drawChart("oaChart", "bar", countBy(all.map((a) => a.oaStatus)), "#0f7b6c", true);
  renderTabs();
  renderTable();
}

function drawCloud(id, entries) {
  const el = $(id);
  el.innerHTML = "";
  if (!entries.length) { el.innerHTML = '<div class="placeholder">No data.</div>'; return; }
  const max = entries[0][1];
  const canvas = document.createElement("canvas");
  canvas.width = el.clientWidth || 500;
  canvas.height = el.clientHeight || 300;
  el.appendChild(canvas);
  WordCloud(canvas, {
    list: entries.map(([w, c]) => [w, 12 + (c / max) * 36]),
    gridSize: 6,
    rotateRatio: 0.15,
    fontFamily: "Arial, Helvetica, sans-serif",
    color: () => ["#6b3fa0", "#0f7b6c", "#1d5fa8", "#b5562c", "#33475b"][Math.floor(Math.random() * 5)],
    backgroundColor: "#ffffff",
  });
}

function drawChart(id, type, entries, color, horizontal) {
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart($(id), {
    type,
    data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: color, borderColor: color, tension: 0.25 }] },
    options: {
      indexAxis: horizontal ? "y" : "x",
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { precision: 0 } }, y: { ticks: { precision: 0 }, beginAtZero: true } },
    },
  });
}

function renderTabs() {
  $("tabs").innerHTML = "";
  CATEGORIES.forEach((c) => {
    const n = state.results[c.key] ? state.results[c.key].articles.length : 0;
    const b = document.createElement("button");
    b.className = "tab" + (c.key === state.active ? " active" : "");
    b.textContent = `${c.label} (${n})`;
    b.onclick = () => { state.active = c.key; renderTabs(); renderTable(); };
    $("tabs").appendChild(b);
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderTable() {
  const rows = activeArticles();
  if (!rows.length) { $("tbody").innerHTML = '<tr><td colspan="8" class="placeholder">No results.</td></tr>'; return; }
  $("tbody").innerHTML = rows.map((a, i) => {
    const au = a.authors.length > 3 ? a.authors.slice(0, 3).join(", ") + " et al." : a.authors.join(", ");
    const links = [`<a href="https://openalex.org/works/${esc(a.id)}" target="_blank">OpenAlex</a>`];
    if (a.doi) links.push(`<a href="https://doi.org/${esc(a.doi)}" target="_blank">DOI</a>`);
    if (a.oaUrl) links.push(`<a href="${esc(a.oaUrl)}" target="_blank">Free full text</a>`);
    return `<tr><td>${i + 1}</td><td>${esc(a.title.replace(/<[^>]+>/g, ""))}</td><td>${esc(au)}</td><td>${esc(a.countries.map(countryName).join(", "))}</td><td>${esc(a.source)}</td><td>${esc(a.year)}</td><td>${a.cited}</td><td>${links.join(" · ")}</td></tr>`;
  }).join("");
}

function reset() {
  state.results = {}; state.groups = {}; state.active = null;
  $("filter").value = ""; $("topic").selectedIndex = 0; $("scope").value = "lis"; $("country").value = "";
  $("perpage").value = "100"; $("sort").value = "publication_date:desc";
  $("stats").innerHTML = ""; $("updated").textContent = "--"; setStatus("");
  ["journalCloud", "wordCloud"].forEach((id) => ($(id).innerHTML = '<div class="placeholder">Select a topic and click Search.</div>'));
  Object.values(state.charts).forEach((c) => c.destroy()); state.charts = {};
  $("tabs").innerHTML = "";
  $("tbody").innerHTML = '<tr><td colspan="8" class="placeholder">No results yet.</td></tr>';
}

// ---------- exports ----------
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function rowsForExport(list) {
  return list.map((a) => ({
    OpenAlexID: a.id, Title: a.title, Authors: a.authors.join("; "), Countries: a.countries.map(countryName).join("; "),
    Institutions: a.institutions.join("; "), Source: a.source, Year: a.year, PublicationDate: a.date, CitedBy: a.cited,
    Type: a.type, OAStatus: a.oaStatus, Keywords: a.keywords.join("; "), DOI: a.doi, FreeFullText: a.oaUrl,
    Abstract: a.abstract, URL: `https://openalex.org/works/${a.id}`,
  }));
}

function xmlEsc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function gexf(nodes, edges, title) {
  const ids = new Map([...nodes.keys()].map((k, i) => [k, i]));
  let out = `<?xml version="1.0" encoding="UTF-8"?>\n<gexf xmlns="http://www.gexf.net/1.3" version="1.3">\n<meta><creator>LIS Atlas</creator><description>${xmlEsc(title)}</description></meta>\n<graph defaultedgetype="undirected">\n<attributes class="node"><attribute id="0" title="frequency" type="integer"/></attributes>\n<nodes>\n`;
  nodes.forEach((w, k) => { out += `<node id="${ids.get(k)}" label="${xmlEsc(k)}"><attvalues><attvalue for="0" value="${w}"/></attvalues></node>\n`; });
  out += "</nodes>\n<edges>\n";
  let e = 0;
  edges.forEach((w, k) => { const [s, t] = k.split("|||"); out += `<edge id="${e++}" source="${ids.get(s)}" target="${ids.get(t)}" weight="${w}"/>\n`; });
  return out + "</edges>\n</graph>\n</gexf>\n";
}

function buildNetwork(list, getItems) {
  const nodes = new Map(), edges = new Map();
  list.forEach((a) => {
    const items = [...new Set(getItems(a))].sort();
    items.forEach((x) => nodes.set(x, (nodes.get(x) || 0) + 1));
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const k = items[i] + "|||" + items[j];
        edges.set(k, (edges.get(k) || 0) + 1);
      }
  });
  return { nodes, edges };
}

function exportData(kind) {
  const list = activeArticles();
  if (!list.length) { setStatus("Run a search first.", true); return; }
  const base = ($("topic").value + "_" + ($("country").value || "world") + "_" + state.active).replace(/[^a-z0-9]+/gi, "_");
  const rows = rowsForExport(list);

  if (kind === "csv") {
    const cols = Object.keys(rows[0]);
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    download(base + ".csv", "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n"), "text/csv");
  } else if (kind === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Works");
    XLSX.writeFile(wb, base + ".xlsx");
  } else if (kind === "ris") {
    const ris = list.map((a) => [
      a.type === "review" ? "TY  - JOUR" : "TY  - JOUR", `TI  - ${a.title}`, ...a.authors.map((x) => `AU  - ${x}`),
      a.source && `JO  - ${a.source}`, `PY  - ${a.year}`, a.doi && `DO  - ${a.doi}`, `UR  - https://openalex.org/works/${a.id}`,
      a.abstract && `AB  - ${a.abstract}`, ...a.keywords.map((k) => `KW  - ${k}`), "ER  - ",
    ].filter(Boolean).join("\r\n")).join("\r\n\r\n");
    download(base + ".ris", ris, "application/x-research-info-systems");
  } else if (kind === "gexf-keywords") {
    const { nodes, edges } = buildNetwork(list, (a) => a.keywords);
    download(base + "_keywords.gexf", gexf(nodes, edges, "Keyword co-occurrence network"), "application/xml");
  } else if (kind === "gexf-authors") {
    const { nodes, edges } = buildNetwork(list.filter((a) => a.authors.length <= 50), (a) => a.authors);
    download(base + "_coauthors.gexf", gexf(nodes, edges, "Co-authorship network"), "application/xml");
  } else if (kind === "gexf-countries") {
    const { nodes, edges } = buildNetwork(list, (a) => a.countries.map(countryName));
    download(base + "_countries.gexf", gexf(nodes, edges, "Country collaboration network"), "application/xml");
  }
}

init();
