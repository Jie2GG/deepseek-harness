---
description: "Browser index access now requires an account name and password, the browser cookie moves to generation-carrying version v3, and three /auth routes plus a settings sign-out action join the Web transport."
kind: upgrade-guide
---

# Browser sign-in with an account name and password

English | [中文](guide.zh.md)

## Change

A browser that opens the served application now authenticates with one account name and one password instead of inheriting the launch token. `dsh web` still prints a URL carrying that token for supervisors and machine clients, but the browser it opens gets the clean URL. `ctx.connection.authorizeIndex` answers an unauthenticated index request with a self-contained `200 text/html` sign-in or setup document instead of 401 text; the page posts JSON to routes this plugin adds beside `/connect`: `POST /auth/setup` stores the first password while none exists, `POST /auth/login` verifies a pair, and `POST /auth/logout` expires the browser cookie. Failed sign-ins per client address and account name face a doubling wait capped at thirty seconds.

The password lives in the owner-scoped `client-connection/password` grant record of `ctx.credentials` as a scrypt digest with protocol-fixed parameters, and `username` (default `dsh`) is a new config field naming the account a fresh setup form offers. A browser cookie is now version `v3` and carries the generation of the password record that signed it, or `launch` when a process token minted it, so changing or deleting the password retires password-signed cookies immediately. Version `v1` browser cookies are refused and land on the sign-in page. API cookies remain version `v2` and `GET /connect?token=...` keeps its published contract, so machine access and the desktop host stay password-free. The settings panel gains a Sign out action for a served page; a carrier that owns its transport has no browser session and hides it.

## Migration

1. Operators set the password on first visit: the page that opens after `dsh web` shows a setup form, and the caller that wins the record race chooses both the name and the password. A forgotten password is recovered by deleting the `client-connection/password` record and restarting, which returns the page to setup.
2. Machine clients keep using the startup line: read the printed URL, then exchange its token at `GET /connect?token=<launch-token>&interactions=none` exactly as before. Browser automation that navigates to `/` must sign in through `/auth/login` or keep exchanging a launch token at the root.
3. Integrators that classify an index response by status now branch on `content-type`: a `401 text/plain` root response means a refused token exchange, while `200 text/html` means no browser session exists yet. Callers that construct `BrowserAuth` pass a loaded `PasswordStore` as the fourth argument (`new PasswordStore(ctx.credentials, username)`, then `await passwords.load()`).
4. Deployments that want a different account name set `username` on `@deepseek-ai/dsh-client-connection`. The password itself never enters `cordis.yml`, so configuration files cannot leak it. Keep TLS configured for any authority reachable off the local machine: over plain HTTP both the cookie and the submitted password travel unencrypted.
