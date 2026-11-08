/**
 * Not deployed. Deploying this function needs explicit approval.
 *
 * The request handler that will sit behind this entry point is
 * `handleMatchRequest` in `@word-arena/online`. Vitest runs that handler.
 * This process stays closed so an unapproved deploy cannot serve an
 * in-memory match or a secret key.
 */
Deno.serve(() =>
  new Response(
    JSON.stringify({
      ok: false,
      code: 'unavailable',
      message: 'The match service is not deployed. Scored plays stay unavailable until an approved dictionary and this function are approved.',
    }),
    { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
  ),
);
