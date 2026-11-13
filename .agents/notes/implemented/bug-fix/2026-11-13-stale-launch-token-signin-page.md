# Agent Note: A stale launch token answers with the sign-in page

Status: implemented

English | [中文](2026-11-13-stale-launch-token-signin-page.zh.md)

## Problem

`BrowserAuth.authorizeIndex` answered any index request whose `token` query parameter it would not exchange with the plain-text 401 from `writeUnauthorized`, while [the Connection README](../../../../packages/client/connection/README.md) and [the frontend-static README](../../../../packages/host/frontend-static/README.md) both promise every other unauthenticated index request a `200` sign-in or setup document. Each `dsh web` launch mints a fresh process token held only in a process-scoped `WeakMap`, so every bookmark, history entry, and supervisor link that still carries the previous token resolves to that 401 after a restart: the browser shows an error with no form, and an account-password sign-in stays unreachable until the reader deletes the query string by hand.

## Decision

The refusal that ends the token branch calls `writeSignInPage`, so a stale, duplicated, or non-root token query now reaches the same page as a request carrying no credential. Two answers stay: a valid root token still mints the authority-bound cookie and redirects to `./`, and a signed-in browser presenting a token on the root path is redirected to `./` without re-exchanging it. `GET /connect?token=...` keeps its 401 because it is the API-operator exchange rather than a browser entry point, and `/api` plus the Gateway stream upgrade keep theirs.

## Alternatives considered

**Render the page only when the request asks for `text/html`.** Content negotiation gives one unresolved credential two answers and hides the browser path from anyone reading a status line, while the index route serves a browser entry point in every case.

**Redirect a stale token to `./` instead of answering with the page.** The extra hop discards the request that arrived, and the redirect already covers the case where a cookie proves the browser is signed in.

**Keep the 401 for machine probes.** Probing an entry point belongs to `/api` and `/connect`, which keep their status codes, and an index probe learns nothing from 401 that the page does not already show.

## Consequences

A bookmarked launch URL stays usable across restarts as a path to the form, so an operator no longer has to strip a query string to sign in. An index `HEAD` reports 200 with the document headers; Node suppresses the body for that method, and the `dsh web authentication required` text now appears only on `/connect`. No cookie format, session data, or published status-code promise for other routes changed.

## Testing

`packages/client/connection/tests/browser-auth.host.spec.ts` answers four token-bearing index requests — a wrong token, two `token` parameters, a token on the configured index path, and a `HEAD` on the launch URL — with the setup document, and separates a signed-in root request, which redirects to `./`, from a guest on the configured index path, which receives the login form. `packages/host/frontend-static/tests/frontend-static.spec.ts` still serves the sign-in page over real HTTP for an index read without a credential, and the `API credentials` case for `/connect` still asserts its 401.
