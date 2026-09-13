// ╔══════════════════════════════════════════════════════════════╗
// ║              🚀 DYNAMIC SVG BUILDER (Terminal Card)         ║
// ║                                                            ║
// ║  Neofetch-style terminal card with live GitHub stats.       ║
// ║  Responsive, zero horizontal scroll, dark/light themes.     ║
// ╚══════════════════════════════════════════════════════════════╝

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Right column layout: first baseline at 30, one line every 20, 20 of padding
// underneath. Everything else sizes itself off the number of lines, so adding
// or removing a line never leaves the card the wrong height.
const FIRST_BASELINE = 30;
const LINE_HEIGHT = 20;
const BOTTOM_PADDING = 20;
const cardHeightFor = rowCount =>
  FIRST_BASELINE + (rowCount - 1) * LINE_HEIGHT + BOTTOM_PADDING;

// ─── XML ESCAPING ─────────────────────────────────────────────
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── DYNAMIC UPTIME ───────────────────────────────────────────
function calculateUptime(startDateStr) {
  const start = new Date(startDateStr);
  const now = new Date();

  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const yStr = `${years} year${years !== 1 ? 's' : ''}`;
  const mStr = `${months} month${months !== 1 ? 's' : ''}`;
  const dStr = `${days} day${days !== 1 ? 's' : ''}`;
  const isBirthday = months === 0 && days === 0;

  return `${yStr}, ${mStr}, ${dStr}${isBirthday ? ' 🎂' : ''}`;
}

// ─── REAL COMMIT AND LINE COUNTS ──────────────────────────────
// GitHub computes per-contributor weekly additions/deletions on the default
// branch, but a repo whose cache is cold answers 202 and starts building it in
// the background. So we ping every repo first, wait, then collect the numbers.
const sleep = ms => new Promise(r => setTimeout(r, ms));

const LOC_CONCURRENCY = 6;
const LOC_WARMUP_WAIT_MS = Number(process.env.LOC_WARMUP_MS ?? 8000);
const LOC_ATTEMPTS = 5;
const LOC_RETRY_WAIT_MS = Number(process.env.LOC_RETRY_MS ?? 4000);

function statsUrl(repo) {
  return `https://api.github.com/repos/${repo.owner.login}/${repo.name}/stats/contributors`;
}

// Runs `worker` over `items`, LOC_CONCURRENCY at a time, so we never open
// dozens of sockets at once.
async function inBatches(items, worker) {
  const out = [];
  for (let i = 0; i < items.length; i += LOC_CONCURRENCY) {
    const batch = items.slice(i, i + LOC_CONCURRENCY);
    out.push(...await Promise.all(batch.map(item => worker(item).catch(() => null))));
  }
  return out;
}

export async function fetchRepoLoc(repo, username, headers) {
  for (let attempt = 0; attempt < LOC_ATTEMPTS; attempt++) {
    const res = await fetch(statsUrl(repo), { headers });

    if (res.status === 202) {
      await sleep(LOC_RETRY_WAIT_MS);
      continue;
    }
    if (res.status === 204) return { additions: 0, deletions: 0, commits: 0 };  // empty repo
    if (!res.ok) return null;

    const contributors = await res.json();
    if (!Array.isArray(contributors)) return null;

    const mine = contributors.find(c => c?.author?.login?.toLowerCase() === username.toLowerCase());
    if (!mine) return { additions: 0, deletions: 0, commits: 0 };

    return mine.weeks.reduce(
      (acc, w) => ({ ...acc, additions: acc.additions + (w.a || 0), deletions: acc.deletions + (w.d || 0) }),
      { additions: 0, deletions: 0, commits: mine.total || 0 }
    );
  }
  return null;  // cache never finished building
}

export async function fetchTotalLoc(repoList, username, headers) {
  const own = repoList.filter(r => !r.fork);
  if (own.length === 0) return null;

  // Warm-up pass: the response is irrelevant, we only want the cache built.
  await inBatches(own, repo => fetch(statsUrl(repo), { headers }));
  await sleep(LOC_WARMUP_WAIT_MS);

  const results = await inBatches(own, repo => fetchRepoLoc(repo, username, headers));

  let additions = 0;
  let deletions = 0;
  let commits = 0;
  let counted = 0;
  for (const r of results) {
    if (!r) continue;
    additions += r.additions;
    deletions += r.deletions;
    commits += r.commits;
    counted++;
  }

  console.log(`   counted ${counted}/${own.length} non-fork repos`);
  return counted > 0 ? { additions, deletions, commits } : null;
}

// ─── FETCH LIVE GITHUB STATS ──────────────────────────────────
async function fetchStats(username) {
  const token = process.env.GITHUB_TOKEN || process.env.ACCESS_TOKEN;
  const headers = {
    'User-Agent': 'github-profile-neofetch',
    Accept: 'application/vnd.github.v3+json',
  };
  if (token) headers.Authorization = `token ${token}`;

  // Zeroed rather than hard-coded, so a failed fetch never shows a stale or
  // borrowed number as if it were real.
  let repos = 0;
  let followers = 0;
  let stars = 0;
  let contributed = 0;
  let createdAt = config.uptimeStartDate;
  let loc = null;

  try {
    const userRes = await fetch(`https://api.github.com/users/${username}`, { headers });
    if (userRes.ok) {
      const u = await userRes.json();
      repos = u.public_repos ?? repos;
      followers = u.followers ?? followers;
      createdAt = u.created_at ?? createdAt;
    }

    const reposRes = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`, { headers });
    if (reposRes.ok) {
      const repoList = await reposRes.json();
      stars = repoList.reduce((acc, r) => acc + (r.stargazers_count || 0), 0);

      console.log('📏 Counting commits and lines of code across owned repos...');
      loc = await fetchTotalLoc(repoList, username, headers);
    }

    if (token) {
      try {
        const query = `
          query($login: String!) {
            user(login: $login) {
              repositoriesContributedTo(first: 1) {
                totalCount
              }
            }
          }
        `;
        const gqlRes = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, variables: { login: username } }),
        });
        if (gqlRes.ok) {
          const gql = await gqlRes.json();
          const userGql = gql?.data?.user;
          if (userGql) {
            contributed = userGql.repositoriesContributedTo?.totalCount || contributed;
          }
        }
      } catch (err) {
        console.warn('GraphQL query warning:', err.message);
      }
    }
  } catch (err) {
    console.error('Stats fetch error:', err.message);
  }

  if (!loc) {
    // Never silently invent numbers: fall back to zero and say so.
    console.warn('⚠️  Commit and line counts unavailable — the card will show 0.');
    loc = { additions: 0, deletions: 0, commits: 0 };
  }
  const { additions, deletions, commits } = loc;
  const netLoc = additions - deletions;

  return { repos, stars, followers, contributed, commits, additions, deletions, netLoc, createdAt };
}

// ─── FORMAT FEATURED PROJECTS CARD ─────────────────────────────
// Greedy word-wrap: fills each line up to maxLen before breaking, same rule
// a terminal `fold` would use.
function wrapText(text, maxLen) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxLen && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function buildProjectLines(projects) {
  const TARGET_LEN = 58;
  const DESC_WIDTH = 52; // leaves room for the 4-space indent inside TARGET_LEN

  const headerPrefix = '- Featured Projects ';
  const headerDashes = '-'.repeat(Math.max(2, TARGET_LEN - headerPrefix.length));

  const rows = [
    { type: 'section', title: 'Featured Projects', dashes: headerDashes },
  ];

  projects.forEach((project, i) => {
    const nameWithColon = project.name + ':';
    const baseLen = 2 + nameWithColon.length + project.tech.length;
    const dots = '.'.repeat(Math.max(2, TARGET_LEN - baseLen));
    rows.push({
      type: 'kv',
      key: escapeXml(nameWithColon),
      dots,
      value: escapeXml(project.tech),
    });

    for (const line of wrapText(project.description, DESC_WIDTH)) {
      rows.push({ type: 'note', text: escapeXml(line) });
    }

    if (i < projects.length - 1) rows.push({ type: 'blank' });
  });

  return rows;
}

function renderProjectsSvg(theme, projectLines) {
  const CARD_WIDTH = 600;
  const CARD_HEIGHT = cardHeightFor(projectLines.length);
  return wrapCard(theme === 'dark', CARD_WIDTH, CARD_HEIGHT, rowsToSvg(projectLines));
}

// ─── FORMAT RIGHT COLUMN WITH DOT LEADERS ─────────────────────
function buildRightLines(stats, uptime) {
  // Target width: exactly 58 characters so right margin matches left margin (25px each)
  const TARGET_LEN = 58;

  function makeDotLine(key, value) {
    const keyWithColon = key + ':';
    // Rendered: '. ' (2) + keyWithColon + dots + value
    const baseLen = 2 + keyWithColon.length + value.length;
    const dotsCount = Math.max(2, TARGET_LEN - baseLen);
    const dots = '.'.repeat(dotsCount);
    return {
      type: 'kv',
      key: escapeXml(keyWithColon),
      dots: dots,
      value: escapeXml(value),
    };
  }

  const headerUser = `${config.name}@${config.host} `;
  const headerDashes = '-'.repeat(Math.max(2, TARGET_LEN - headerUser.length));

  const statsPrefix = '- GitHub Stats ';
  const statsDashes = '-'.repeat(Math.max(2, TARGET_LEN - statsPrefix.length));

  // Stats line 1 (Repos & Stars) exactly 58 chars
  const reposStr = stats.repos.toLocaleString();
  const contributedStr = stats.contributed.toLocaleString();
  const starsStr = stats.stars.toLocaleString();
  const reposPrefix = `. Repos: ${reposStr} {Contributed: ${contributedStr}}`;
  const starsBaseLen = reposPrefix.length + ' | Stars: '.length + starsStr.length;
  const starsDots = '.'.repeat(Math.max(2, TARGET_LEN - starsBaseLen));

  // Stats line 2 (Commits & Followers) exactly 58 chars, '|' aligned with line 1
  const commitsStr = stats.commits.toLocaleString();
  const followersStr = stats.followers.toLocaleString();
  // Dots between 'Commits:' label and commits value so count sits right before '|'
  const commitsDotsCount = reposPrefix.length - (2 + 'Commits:'.length + commitsStr.length);
  const commitsDots = '.'.repeat(Math.max(2, commitsDotsCount));

  const followersBaseLen = reposPrefix.length + ' | Followers: '.length + followersStr.length;
  const followersDots = '.'.repeat(Math.max(2, TARGET_LEN - followersBaseLen));

  // Stats line 3 (Lines of Code) exactly 58 chars, '(' aligned with '|' of lines above
  const locStr = stats.netLoc.toLocaleString();
  const addedStr = stats.additions.toLocaleString();
  const delStr = stats.deletions.toLocaleString();
  // Dots between 'Lines of Code:' label and loc value so count sits right before '('
  const locMidDotsCount = reposPrefix.length - (2 + 'Lines of Code:'.length + locStr.length);
  const locMidDots = '.'.repeat(Math.max(2, locMidDotsCount));

  // Content inside parenthesis with space before end dots
  const insideParen = `${addedStr}++, ${delStr}-- `;
  const endDotsCount = TARGET_LEN - (reposPrefix.length + 3 + insideParen.length + 2);
  const endDots = '.'.repeat(Math.max(2, endDotsCount));

  return [
    {
      type: 'header',
      user: escapeXml(headerUser),
      dashes: headerDashes,
    },
    makeDotLine('Host', config.role),
    makeDotLine('Uptime', uptime),
    makeDotLine('Kernel', config.kernel),
    makeDotLine('Databases', config.databases),
    makeDotLine('DevOps', config.devops),
    { type: 'blank' },
    makeDotLine('Languages.Code', config.languagesCode),
    makeDotLine('Frontend', config.frontend),
    makeDotLine('Backend', config.backend),
    { type: 'blank' },
    makeDotLine('Native', config.native),
    makeDotLine('Tools', config.tools),
    makeDotLine('Focus', config.focus),
    { type: 'blank' },
    {
      type: 'section',
      title: 'GitHub Stats',
      dashes: statsDashes,
    },
    {
      type: 'stats_repos_stars',
      repos: reposStr,
      contributed: contributedStr,
      starsDots: starsDots,
      stars: starsStr,
    },
    {
      type: 'stats_commits_followers',
      commits: commitsStr,
      commitsDots: commitsDots,
      followersDots: followersDots,
      followers: followersStr,
    },
    {
      type: 'stats_loc',
      loc: locStr,
      locMidDots: locMidDots,
      added: addedStr,
      deleted: delStr,
      endDots: endDots,
    },
  ];
}

// ─── RENDER RESPONSIVE SVG (DARK & LIGHT) ─────────────────────
// Both cards (stats + projects) share the same palette and envelope.
function colorsFor(isDark) {
  return isDark
    ? {
        cardBg: '#0d1017',   // Dark mode background per user request
        border: '',
        key: '#ffa657',      // Orange
        value: '#a5d6ff',    // Light blue
        cc: '#616e7f',       // Gray dots
        add: '#3fb950',      // Green
        del: '#f85149',      // Red
        title: '#c9d1d9',
      }
    : {
        cardBg: '#ffffff',   // Light mode background
        border: 'stroke="#d0d7de" stroke-width="1"',
        key: '#bc4c00',      // Deep orange
        value: '#0969da',    // GitHub blue
        cc: '#6e7781',       // Neutral gray
        add: '#1a7f37',      // Dark green
        del: '#cf222e',      // Red
        title: '#24292f',
      };
}

// Renders one row descriptor to a <text> line. Shared by every card — a row
// type only needs to exist here once, not once per card that might use it.
function rowToSvg(r, y) {
  let inner = '';
  if (!r || r.type === 'blank') {
    inner = `<tspan class="cc">. </tspan>`;
  } else if (r.type === 'header') {
    inner = `<tspan class="key">${r.user}</tspan><tspan class="cc">${r.dashes}</tspan>`;
  } else if (r.type === 'section') {
    inner = `<tspan class="cc">- </tspan><tspan class="title">${r.title} </tspan><tspan class="cc">${r.dashes}</tspan>`;
  } else if (r.type === 'kv') {
    inner = `<tspan class="cc">. </tspan><tspan class="key">${r.key}</tspan><tspan class="cc">${r.dots}</tspan><tspan class="value">${r.value}</tspan>`;
  } else if (r.type === 'note') {
    inner = `<tspan class="cc">    ${r.text}</tspan>`;
  } else if (r.type === 'stats_repos_stars') {
    inner = `<tspan class="cc">. </tspan><tspan class="key">Repos: </tspan><tspan class="value">${r.repos}</tspan><tspan class="key"> {Contributed: </tspan><tspan class="value">${r.contributed}</tspan><tspan class="key">}</tspan><tspan class="cc"> | </tspan><tspan class="key">Stars: </tspan><tspan class="cc">${r.starsDots}</tspan><tspan class="value">${r.stars}</tspan>`;
  } else if (r.type === 'stats_commits_followers') {
    inner = `<tspan class="cc">. </tspan><tspan class="key">Commits:</tspan><tspan class="cc">${r.commitsDots}</tspan><tspan class="value">${r.commits}</tspan><tspan class="cc"> | </tspan><tspan class="key">Followers: </tspan><tspan class="cc">${r.followersDots}</tspan><tspan class="value">${r.followers}</tspan>`;
  } else if (r.type === 'stats_loc') {
    inner = `<tspan class="cc">. </tspan><tspan class="key">Lines of Code:</tspan><tspan class="cc">${r.locMidDots}</tspan><tspan class="value">${r.loc}</tspan><tspan class="cc"> ( </tspan><tspan class="addColor">${r.added}++</tspan><tspan class="cc">, </tspan><tspan class="delColor">${r.deleted}-- </tspan><tspan class="cc">${r.endDots} )</tspan>`;
  }
  return `  <text x="25" y="${y}" xml:space="preserve">${inner}</text>\n`;
}

function rowsToSvg(rows) {
  return rows.map((r, i) => rowToSvg(r, FIRST_BASELINE + i * LINE_HEIGHT)).join('');
}

// The card chrome (rounded rect, clip path, colour classes) is identical
// between cards — only the rows and dimensions differ.
function wrapCard(isDark, width, height, rowsSvg) {
  const colors = colorsFor(isDark);

  return `<?xml version='1.0' encoding='UTF-8'?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" xml:space="preserve" font-family="Consolas, 'Courier New', monospace">
<defs>
  <clipPath id="cardClip">
    <rect width="${width}px" height="${height}px" rx="15"/>
  </clipPath>
</defs>
<style>
.key { fill: ${colors.key}; font-weight: 500; font-size: 16px; }
.value { fill: ${colors.value}; font-size: 16px; }
.addColor { fill: ${colors.add}; font-size: 16px; }
.delColor { fill: ${colors.del}; font-size: 16px; }
.cc { fill: ${colors.cc}; font-size: 16px; }
.title { fill: ${colors.title}; font-size: 16px; }
text, tspan { white-space: pre; }
</style>

<!-- Card Base -->
<rect width="${width}px" height="${height}px" fill="${colors.cardBg}" rx="15" ${colors.border}/>

<!-- Neofetch Content -->
<g clip-path="url(#cardClip)" font-size="16px">
${rowsSvg}
</g>
</svg>
`;
}

function renderSvg(theme, rightLines) {
  const CARD_WIDTH = 600;
  const CARD_HEIGHT = cardHeightFor(rightLines.length);
  return wrapCard(theme === 'dark', CARD_WIDTH, CARD_HEIGHT, rowsToSvg(rightLines));
}

// ─── MAIN EXECUTION ───────────────────────────────────────────
export async function build() {
  console.log('🚀 Building neofetch terminal SVGs...\n');

  console.log(`📊 Fetching stats for @${config.username}...`);
  const stats = await fetchStats(config.username);

  const uptime = calculateUptime(stats.createdAt || config.uptimeStartDate);
  console.log(`⏱️  Uptime (from GitHub join date): ${uptime}`);

  const rightLines = buildRightLines(stats, uptime);

  console.log('🖼️  Writing responsive dark_mode.svg and light_mode.svg...');
  const darkSvg = renderSvg('dark', rightLines);
  const lightSvg = renderSvg('light', rightLines);

  fs.writeFileSync(path.join(ROOT, 'dark_mode.svg'), darkSvg, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'light_mode.svg'), lightSvg, 'utf8');

  console.log('🖼️  Writing responsive projects_dark.svg and projects_light.svg...');
  const projectLines = buildProjectLines(config.projects ?? []);
  fs.writeFileSync(path.join(ROOT, 'projects_dark.svg'), renderProjectsSvg('dark', projectLines), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'projects_light.svg'), renderProjectsSvg('light', projectLines), 'utf8');

  console.log('✅ Built dark_mode.svg, light_mode.svg, projects_dark.svg and projects_light.svg');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error('❌ Build failed:', err);
    process.exit(1);
  });
}
