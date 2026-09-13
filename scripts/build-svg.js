// ╔══════════════════════════════════════════════════════════════╗
// ║        🚀 DYNAMIC SVG BUILDER (Edge-to-Edge Pixel Grid)    ║
// ║                                                            ║
// ║  • Left: Edge-to-edge pixel grid (zero padding, full height)║
// ║    with subtle matrix grid lines and chunky avatar tiles   ║
// ║  • Right: Tailored Neofetch terminal card with live stats  ║
// ║  • Responsive, zero horizontal scroll, dark/light themes    ║
// ╚══════════════════════════════════════════════════════════════╝

import sharp from 'sharp';
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

// ─── GENERATE CHUNKY PIXEL PORTRAIT ───────────────────────────
// Renders the avatar as a grid of flat colour tiles (one <rect> per tile),
// which survives any font stack — unlike glyph based ASCII art.
async function generatePixelArt(imagePath, cardHeight) {
  const CELL = 12;                 // tile size in SVG units
  const INSET = 20;                // breathing room above and below the art
  const GRID = Math.floor((cardHeight - INSET * 2) / CELL);  // tiles per side
  const ORIGIN_X = 10;
  const ORIGIN_Y = Math.round((cardHeight - GRID * CELL) / 2);

  let pipeline = sharp(imagePath);
  if (config.avatarCrop) pipeline = pipeline.extract(config.avatarCrop);

  const { data } = await pipeline
    .modulate({ brightness: 1.05, saturation: 1.2 })
    .resize(GRID, GRID, { fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  function buildPixelSvg(isDark) {
    let out = '';
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const i = (r * GRID + c) * 4;
        const alpha = data[i + 3];
        if (alpha < 35) continue;

        let [red, green, blue] = [data[i], data[i + 1], data[i + 2]];
        if (config.grayscalePixels) {
          const lum = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
          red = green = blue = lum;
        }
        // lift the darkest tiles off the card background so the shape stays visible
        const floor = isDark ? 26 : 0;
        const lift = v => Math.max(floor, isDark ? v : Math.min(255, Math.round(v * 0.95 + 12)));
        const hex = '#' + [lift(red), lift(green), lift(blue)]
          .map(v => v.toString(16).padStart(2, '0'))
          .join('');

        const x = ORIGIN_X + c * CELL;
        const y = ORIGIN_Y + r * CELL;
        out += `    <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${hex}"/>\n`;
      }
    }
    return out;
  }

  return { buildPixelSvg };
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
function renderSvg(theme, pixelData, rightLines) {
  const isDark = theme === 'dark';

  const colors = isDark
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

  const leftPixelSvg = pixelData.buildPixelSvg(isDark);

  // Generate right column lines
  let rowsSvg = '';
  for (let i = 0; i < rightLines.length; i++) {
    const y = FIRST_BASELINE + i * LINE_HEIGHT;
    const r = rightLines[i];

    let rightSvg = '';
    if (!r || r.type === 'blank') {
      rightSvg = `<tspan class="cc">. </tspan>`;
    } else if (r.type === 'header') {
      rightSvg = `<tspan class="key">${r.user}</tspan><tspan class="cc">${r.dashes}</tspan>`;
    } else if (r.type === 'section') {
      rightSvg = `<tspan class="cc">- </tspan><tspan class="title">${r.title} </tspan><tspan class="cc">${r.dashes}</tspan>`;
    } else if (r.type === 'kv') {
      rightSvg = `<tspan class="cc">. </tspan><tspan class="key">${r.key}</tspan><tspan class="cc">${r.dots}</tspan><tspan class="value">${r.value}</tspan>`;
    } else if (r.type === 'stats_repos_stars') {
      rightSvg = `<tspan class="cc">. </tspan><tspan class="key">Repos: </tspan><tspan class="value">${r.repos}</tspan><tspan class="key"> {Contributed: </tspan><tspan class="value">${r.contributed}</tspan><tspan class="key">}</tspan><tspan class="cc"> | </tspan><tspan class="key">Stars: </tspan><tspan class="cc">${r.starsDots}</tspan><tspan class="value">${r.stars}</tspan>`;
    } else if (r.type === 'stats_commits_followers') {
      rightSvg = `<tspan class="cc">. </tspan><tspan class="key">Commits:</tspan><tspan class="cc">${r.commitsDots}</tspan><tspan class="value">${r.commits}</tspan><tspan class="cc"> | </tspan><tspan class="key">Followers: </tspan><tspan class="cc">${r.followersDots}</tspan><tspan class="value">${r.followers}</tspan>`;
    } else if (r.type === 'stats_loc') {
      rightSvg = `<tspan class="cc">. </tspan><tspan class="key">Lines of Code:</tspan><tspan class="cc">${r.locMidDots}</tspan><tspan class="value">${r.loc}</tspan><tspan class="cc"> ( </tspan><tspan class="addColor">${r.added}++</tspan><tspan class="cc">, </tspan><tspan class="delColor">${r.deleted}-- </tspan><tspan class="cc">${r.endDots} )</tspan>`;
    }

    rowsSvg += `  <text x="420" y="${y}" xml:space="preserve">${rightSvg}</text>\n`;
  }

  const CARD_WIDTH = 1000;
  const CARD_HEIGHT = cardHeightFor(rightLines.length);

  return `<?xml version='1.0' encoding='UTF-8'?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" width="100%" height="auto" xml:space="preserve" font-family="Consolas, 'Courier New', monospace">
<defs>
  <clipPath id="cardClip">
    <rect width="${CARD_WIDTH}px" height="${CARD_HEIGHT}px" rx="15"/>
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
<rect width="${CARD_WIDTH}px" height="${CARD_HEIGHT}px" fill="${colors.cardBg}" rx="15" ${colors.border}/>

<!-- Left Pixel Portrait -->
<g clip-path="url(#cardClip)" shape-rendering="crispEdges">
${leftPixelSvg}
</g>

<!-- Right Neofetch Content -->
<g clip-path="url(#cardClip)" font-size="16px">
${rowsSvg}
</g>
</svg>
`;
}

// ─── MAIN EXECUTION ───────────────────────────────────────────
export async function build() {
  console.log('🚀 Building neofetch terminal SVGs...\n');

  console.log(`📊 Fetching stats for @${config.username}...`);
  const stats = await fetchStats(config.username);

  const uptime = calculateUptime(stats.createdAt || config.uptimeStartDate);
  console.log(`⏱️  Uptime (from GitHub join date): ${uptime}`);

  const rightLines = buildRightLines(stats, uptime);

  console.log('🎨 Generating chunky pixel portrait...');
  const avatarPath = path.join(ROOT, config.avatarImage);
  const pixelData = await generatePixelArt(avatarPath, cardHeightFor(rightLines.length));

  console.log('🖼️  Writing responsive dark_mode.svg and light_mode.svg...');
  const darkSvg = renderSvg('dark', pixelData, rightLines);
  const lightSvg = renderSvg('light', pixelData, rightLines);

  fs.writeFileSync(path.join(ROOT, 'dark_mode.svg'), darkSvg, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'light_mode.svg'), lightSvg, 'utf8');

  console.log('✅ Built dark_mode.svg and light_mode.svg');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error('❌ Build failed:', err);
    process.exit(1);
  });
}
