// Self-check for the lines-of-code aggregation. Run with: npm test
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
const contributors = (login, weeks) => [{ author: { login }, weeks }];

// 1. Sums every week's additions and deletions for the matching author.
stubFetch(() => ({ status: 200, body: contributors('me', [week(100, 10), week(50, 5)]) }));
assert.deepEqual(
  await fetchRepoLoc(repo('a'), 'me', HEADERS),
  { additions: 150, deletions: 15 },
);

// 2. Matches the author case-insensitively.
stubFetch(() => ({ status: 200, body: contributors('Me', [week(7, 3)]) }));
assert.deepEqual(
  await fetchRepoLoc(repo('a'), 'mE', HEADERS),
  { additions: 7, deletions: 3 },
);

// 3. Ignores other contributors' lines.
stubFetch(() => ({
  status: 200,
  body: [
    { author: { login: 'someone-else' }, weeks: [week(9999, 9999)] },
    { author: { login: 'me' }, weeks: [week(4, 1)] },
  ],
}));
assert.deepEqual(
  await fetchRepoLoc(repo('a'), 'me', HEADERS),
  { additions: 4, deletions: 1 },
);

// 4. Retries while GitHub answers 202, then reads the built cache.
let getCalls = stubFetch((_name, n) =>
  n < 3 ? { status: 202 } : { status: 200, body: contributors('me', [week(20, 2)]) });
assert.deepEqual(
  await fetchRepoLoc(repo('a'), 'me', HEADERS),
  { additions: 20, deletions: 2 },
);
assert.equal(getCalls(), 3);

// 5. Gives up (null, not zero) when the cache never finishes building.
stubFetch(() => ({ status: 202 }));
assert.equal(await fetchRepoLoc(repo('a'), 'me', HEADERS), null);

// 6. An empty repo counts as zero, not as a failure.
stubFetch(() => ({ status: 204 }));
assert.deepEqual(await fetchRepoLoc(repo('a'), 'me', HEADERS), { additions: 0, deletions: 0 });

// 7. A repo with no commits by us counts as zero.
stubFetch(() => ({ status: 200, body: contributors('someone-else', [week(500, 500)]) }));
assert.deepEqual(await fetchRepoLoc(repo('a'), 'me', HEADERS), { additions: 0, deletions: 0 });

// 8. Totals across repos, skipping forks and repos that failed.
stubFetch(name =>
  name === 'broken'
    ? { status: 500 }
    : { status: 200, body: contributors('me', [week(10, 1)]) });
const total = await fetchTotalLoc(
  [repo('a'), repo('b'), { ...repo('upstream'), fork: true }, repo('broken')],
  'me',
  HEADERS,
);
assert.deepEqual(total, { additions: 20, deletions: 2 });

// 9. Returns null when nothing could be counted, so the caller can say so
//    instead of printing a confident 0.
stubFetch(() => ({ status: 500 }));
assert.equal(await fetchTotalLoc([repo('a')], 'me', HEADERS), null);

// 10. No non-fork repos at all is also null.
assert.equal(await fetchTotalLoc([{ ...repo('upstream'), fork: true }], 'me', HEADERS), null);

console.log('✅ lines-of-code self-check passed');
