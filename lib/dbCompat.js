// Postgres error 42703 ("column ... does not exist") shows up whenever an
// admin API route touches a column from an optional migration that hasn't
// been run yet on a given deployment -- e.g. `ads.owner_email` (schema-v12)
// or `ads.link_only` (schema-v15). Since those migrations are independent
// of each other, a deployment could be missing either one, both, or
// neither, and hardcoding a single-column retry (as this app used to do,
// just for owner_email) stops covering the case as soon as a second
// optional column exists.
//
// This instead retries in a loop: on a 42703, it pulls the actual missing
// column name out of Postgres's own error message and strips just that key
// from the payload, then tries again. That way a save still succeeds with
// whatever columns *do* exist, no matter how many newer optional ones a
// given deployment hasn't migrated in yet.
export async function withMissingColumnRetry(payload, run) {
  let current = { ...payload };
  for (;;) {
    const result = await run(current);
    if (!result.error || result.error.code !== '42703') return result;
    const match = /column "(\w+)"/.exec(result.error.message || '');
    if (!match || !(match[1] in current)) return result;
    const { [match[1]]: _dropped, ...rest } = current;
    current = rest;
  }
}
