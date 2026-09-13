// Self-check for the commit and lines-of-code aggregation. Run with: npm test
// Stubs global fetch so nothing here touches the network.
process.env.LOC_WARMUP_MS = '0';
process.env.LOC_RETRY_MS = '0';

import assert from 'node:assert/strict';
const { fetchRepoLoc, fetchTotalLoc } = await import('./build-svg.js');

const HEADERS = {};
const repo = name => ({ name, owner: { login: 'me' }, fork: false });

function stubFetch(responder) {
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    const name = url.split('/').slice(-3)[0];
    const r = responder(name, calls);
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body,
    };
  };
  return () => calls;
}

const week = (a, d) => ({ a, d });
const contributors = (login, weeks, total = weeks.length) => [{ author: { login }, weeks, total }];

// 1. Sums every week's additions and deletions, and takes the commit count
//    from the contributor's own total rather than the week count.
stubFetch(() => ({ status: 200, body: contributors('me', [week(100, 10), week(50, 5)], 42) }));
assert.deepEqual(
  await fetchRepoLoc(repo('a'), 'me', HEADERS),
  { additions: 150, deletions: 15, commits: 42 },
);

// 2. Matches the author case-insensitively.
stubFetch(() => ({ status: 200, body: contributors('Me', [week(7, 3)], 1) }));
assert.deepEqual(
  await fetchRepoLoc(repo('a'), 'mE', HEADERS),
  { additions: 7, deletions: 3, commits: 1 },
);

// 3. Ignores other contributors' lines and commits.
stubFetch(() => ({
  status: 200,
  body: [
    { author: { login: 'someone-else' }, weeks: [week(9999, 9999)], total: 9999 },
    { author: { login: 'me' }, weeks: [week(4, 1)], total: 3 },
  ],
}));
assert.deepEqual(
  await fetchRepoLoc(repo('a'), 'me', HEADERS),
  { additions: 4, deletions: 1, commits: 3 },
);

// 3b. A missing total counts as zero commits, not NaN.
stubFetch(() => ({ status: 200, body: [{ author: { login: 'me' }, weeks: [week(5, 0)] }] }));
assert.deepEqual(
  await fetchRepoLoc(repo('a'), 'me', HEADERS),
  { additions: 5, deletions: 0, commits: 0 },
);

// 4. Retries while GitHub answers 202, then reads the built cache.
let getCalls = stubFetch((_name, n) =>
  n < 3 ? { status: 202 } : { status: 200, body: contributors('me', [week(20, 2)], 6) });
assert.deepEqual(
  await fetchRepoLoc(repo('a'), 'me', HEADERS),
  { additions: 20, deletions: 2, commits: 6 },
);
assert.equal(getCalls(), 3);

// 5. Gives up (null, not zero) when the cache never finishes building.
stubFetch(() => ({ status: 202 }));
assert.equal(await fetchRepoLoc(repo('a'), 'me', HEADERS), null);

// 6. An empty repo counts as zero, not as a failure.
stubFetch(() => ({ status: 204 }));
assert.deepEqual(await fetchRepoLoc(repo('a'), 'me', HEADERS), { additions: 0, deletions: 0, commits: 0 });

// 7. A repo with no commits by us counts as zero.
stubFetch(() => ({ status: 200, body: contributors('someone-else', [week(500, 500)], 500) }));
assert.deepEqual(await fetchRepoLoc(repo('a'), 'me', HEADERS), { additions: 0, deletions: 0, commits: 0 });

// 8. Totals across repos, skipping forks and repos that failed.
stubFetch(name =>
  name === 'broken'
    ? { status: 500 }
    : { status: 200, body: contributors('me', [week(10, 1)], 5) });
const total = await fetchTotalLoc(
  [repo('a'), repo('b'), { ...repo('upstream'), fork: true }, repo('broken')],
  'me',
  HEADERS,
);
assert.deepEqual(total, { additions: 20, deletions: 2, commits: 10 });

// 9. Returns null when nothing could be counted, so the caller can say so
//    instead of printing a confident 0.
stubFetch(() => ({ status: 500 }));
assert.equal(await fetchTotalLoc([repo('a')], 'me', HEADERS), null);

// 10. No non-fork repos at all is also null.
assert.equal(await fetchTotalLoc([{ ...repo('upstream'), fork: true }], 'me', HEADERS), null);

console.log('✅ commit and lines-of-code self-check passed');
