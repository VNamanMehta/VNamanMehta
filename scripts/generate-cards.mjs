// Generates the profile cards in assets/ from GitHub's own GraphQL API.
//
// Nothing here depends on a third-party rendering service. We pull the raw
// contribution numbers from GitHub and draw the SVGs ourselves, so the only
// thing that can ever be unavailable is GitHub itself — and if that is down,
// the profile page is down too. The SVG markup below is the template; the API
// supplies the data that gets substituted into it.
//
// Usage: GITHUB_TOKEN=<token> PROFILE_USER=<login> node scripts/generate-cards.mjs
//
// The token should be a PAT with `repo` scope if you want private
// contributions counted. The default Actions GITHUB_TOKEN only sees public
// ones, which makes the totals look much lower than your profile shows.

import { writeFileSync, mkdirSync } from "node:fs";

const TOKEN = process.env.GITHUB_TOKEN;
const USER = process.env.PROFILE_USER;

if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");
if (!USER) throw new Error("PROFILE_USER is not set");

// ── theme ──────────────────────────────────────────────────────────────────

const BG = "#1a1b27";
const PURPLE = "#7c3aed";
const CYAN = "#06b6d4";
const TEXT = "#c0caf5";
const MUTED = "#7f88a8";

const FONT = "Segoe UI, -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif";

// Warm accent for the streak flame. Deliberately off-palette: a purple or cyan
// flame does not read as fire.
const FIRE = "#f97316";
const FIRE_CORE = "#fbbf24";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── data ───────────────────────────────────────────────────────────────────

async function graphql(query) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-card-generator",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) throw new Error(`GitHub API returned ${res.status} ${res.statusText}`);

  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function fetchDays() {
  const { user } = await graphql(`{ user(login: "${USER}") { createdAt } }`);
  const startYear = new Date(user.createdAt).getUTCFullYear();
  const endYear = new Date().getUTCFullYear();

  const days = [];
  for (let year = startYear; year <= endYear; year++) {
    const data = await graphql(`{
      user(login: "${USER}") {
        contributionsCollection(from: "${year}-01-01T00:00:00Z", to: "${year}-12-31T23:59:59Z") {
          contributionCalendar {
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }`);

    for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) {
        days.push({ date: day.date, count: day.contributionCount });
      }
    }
  }

  const byDate = new Map();
  for (const day of days) {
    const seen = byDate.get(day.date);
    if (!seen || day.count > seen.count) byDate.set(day.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function fmt(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function fmtShort(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function fmtRange(startIso, endIso) {
  const thisYear = new Date().getUTCFullYear();
  const startYear = Number(startIso.slice(0, 4));
  const endYear = Number(endIso.slice(0, 4));
  const base = `${fmtShort(startIso)} - ${fmtShort(endIso)}`;

  if (startYear === thisYear && endYear === thisYear) return base;
  if (startYear === endYear) return `${base}, ${endYear}`;
  // A streak spanning New Year needs both years to make sense.
  return `${fmtShort(startIso)}, ${startYear} - ${fmtShort(endIso)}, ${endYear}`;
}

function computeStats(days) {
  const total = days.reduce((sum, d) => sum + d.count, 0);
  let longest = 0;
  let longestStart = null;
  let longestEnd = null;
  let runLength = 0;
  let runStart = null;

  for (const day of days) {
    if (day.count > 0) {
      if (runLength === 0) runStart = day.date;
      runLength++;
      if (runLength > longest) {
        longest = runLength;
        longestStart = runStart;
        longestEnd = day.date;
      }
    } else {
      runLength = 0;
    }
  }

  let current = 0;
  let currentStart = null;
  let currentEnd = null;
  const today = new Date().toISOString().slice(0, 10);

  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    if (day.date > today) continue; // calendar weeks can run past today
    if (day.count === 0) {
      if (day.date === today && current === 0) continue;
      break;
    }
    if (current === 0) currentEnd = day.date;
    current++;
    currentStart = day.date;
  }

  return {
    total,
    totalStart: days.length ? days.find((d) => d.count > 0)?.date ?? days[0].date : null,
    current,
    currentStart,
    currentEnd,
    longest,
    longestStart,
    longestEnd,
  };
}

// ── rendering ──────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A flame, drawn as a path so the card stays a single self-contained file with
// no font or emoji dependency — an emoji glyph would render differently on
// every platform, and not at all in some SVG rasterisers.
function flame(cx, cy, scale = 1) {
  return `
  <g transform="translate(${cx}, ${cy}) scale(${scale})">
    <path d="M0,-13 C5,-7 9,-4.5 9,1.5 C9,7.5 4.8,12 0,12 C-4.8,12 -9,7.5 -9,1.5 C-9,-4.5 -5,-7 0,-13 Z" fill="${FIRE}"/>
    <path d="M0,-4 C2.6,-1 4.2,0.6 4.2,3.4 C4.2,6.6 2.3,9 0,9 C-2.3,9 -4.2,6.6 -4.2,3.4 C-4.2,0.6 -2.6,-1 0,-4 Z" fill="${FIRE_CORE}"/>
  </g>`;
}

function streakCard(s) {
  const W = 495;
  const H = 195;
  const col = W / 3;

  // All three columns share the same baselines so the labels line up, with the
  // middle number sitting inside a ring at the same optical height as the
  // numbers either side of it.
  const numberY = 88;
  const labelY = 140;
  const rangeY = 162;
  const ringCY = 74;
  const ringR = 40;

  const panel = (i, value, label, range, accent, ring = false) => {
    const cx = col * i + col / 2;

    // The ring is broken at the top by a background-coloured disc so the flame
    // sits in a gap rather than on top of the stroke.
    const ringMarkup = ring
      ? `
      <circle cx="${cx}" cy="${ringCY}" r="${ringR}" fill="none" stroke="${accent}" stroke-width="2.5"/>
      <circle cx="${cx}" cy="${ringCY - ringR}" r="13" fill="${BG}"/>
      ${flame(cx, ringCY - ringR, 0.85)}`
      : "";

    return `
    <g>${ringMarkup}
      <text x="${cx}" y="${numberY}" text-anchor="middle" fill="${accent}" font-family="${FONT}" font-size="${ring ? 30 : 36}" font-weight="700">${esc(value)}</text>
      <text x="${cx}" y="${labelY}" text-anchor="middle" fill="${TEXT}" font-family="${FONT}" font-size="13" font-weight="600">${esc(label)}</text>
      <text x="${cx}" y="${rangeY}" text-anchor="middle" fill="${MUTED}" font-family="${FONT}" font-size="11">${esc(range)}</text>
    </g>`;
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub contribution streak">
  <rect width="${W}" height="${H}" rx="10" fill="${BG}"/>
  <line x1="${col}" y1="34" x2="${col}" y2="${H - 30}" stroke="${MUTED}" stroke-opacity="0.25"/>
  <line x1="${col * 2}" y1="34" x2="${col * 2}" y2="${H - 30}" stroke="${MUTED}" stroke-opacity="0.25"/>
  ${panel(0, s.total, "Total Contributions", `${fmt(s.totalStart)} - Present`, CYAN)}
  ${panel(1, s.current, "Current Streak", s.current ? fmtRange(s.currentStart, s.currentEnd) : "—", PURPLE, true)}
  ${panel(2, s.longest, "Longest Streak", s.longest ? fmtRange(s.longestStart, s.longestEnd) : "—", CYAN)}
</svg>
`;
}

function activityGraph(days, windowDays = 90) {
  const W = 1200;
  const H = 420;
  const padL = 60;
  const padR = 30;
  const padT = 50;
  const padB = 55;

  const today = new Date().toISOString().slice(0, 10);
  const recent = days.filter((d) => d.date <= today).slice(-windowDays);

  const max = Math.max(1, ...recent.map((d) => d.count));
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const x = (i) => padL + (recent.length === 1 ? plotW / 2 : (i * plotW) / (recent.length - 1));
  const y = (v) => padT + plotH - (v / max) * plotH;

  const line = recent.map((d, i) => `${x(i).toFixed(1)},${y(d.count).toFixed(1)}`).join(" ");
  const area = `${padL},${padT + plotH} ${line} ${(padL + plotW).toFixed(1)},${padT + plotH}`;

  const ticks = 4;
  let grid = "";
  for (let t = 0; t <= ticks; t++) {
    const v = Math.round((max / ticks) * t);
    const gy = y(v);
    grid += `
  <line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="${MUTED}" stroke-opacity="0.18"/>
  <text x="${padL - 12}" y="${(gy + 4).toFixed(1)}" text-anchor="end" fill="${MUTED}" font-family="${FONT}" font-size="12">${v}</text>`;
  }

  const step = Math.max(1, Math.ceil(recent.length / 12));
  const MIN_LABEL_GAP = 55;
  let labels = "";
  let lastLabelX = -Infinity;
  recent.forEach((d, i) => {
    const isLast = i === recent.length - 1;
    if (i % step !== 0 && !isLast) return;
    if (x(i) - lastLabelX < MIN_LABEL_GAP) return;
    lastLabelX = x(i);
    labels += `
  <text x="${x(i).toFixed(1)}" y="${H - padB + 26}" text-anchor="middle" fill="${MUTED}" font-family="${FONT}" font-size="12">${esc(fmtShort(d.date))}</text>`;
  });

  const dense = recent.length > 45;
  const dots = recent
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => !dense || d.count > 0)
    .map(({ d, i }) => `<circle cx="${x(i).toFixed(1)}" cy="${y(d.count).toFixed(1)}" r="3.5" fill="${BG}" stroke="${CYAN}" stroke-width="2"/>`)
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Contribution activity over the last ${recent.length} days">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${PURPLE}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${PURPLE}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="10" fill="${BG}"/>
  <text x="${padL}" y="32" fill="${TEXT}" font-family="${FONT}" font-size="15" font-weight="600">Contributions — last ${recent.length} days</text>
  ${grid}
  <polygon points="${area}" fill="url(#fade)"/>
  <polyline points="${line}" fill="none" stroke="${CYAN}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${labels}
</svg>
`;
}

// ── main ───────────────────────────────────────────────────────────────────

const days = await fetchDays();
if (!days.length) throw new Error("no contribution data returned");

const stats = computeStats(days);

mkdirSync("assets", { recursive: true });
writeFileSync("assets/streak.svg", streakCard(stats));
writeFileSync("assets/activity-graph.svg", activityGraph(days));

console.log(
  `days=${days.length} total=${stats.total} current=${stats.current} longest=${stats.longest}`
);
console.log("wrote assets/streak.svg and assets/activity-graph.svg");
