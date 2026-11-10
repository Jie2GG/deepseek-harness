---
description: "Browser index access now requires an account name and password; the browser cookie moves to generation-carrying version v3; six /auth routes plus a Settings sign-in section join the Web transport."
kind: upgrade-guide
---

# Browser sign-in with an account name and password

English | [中文](guide.zh.md)

## Change

A browser opening the served application now authenticates with an account name and password instead of inheriting the launch token. `dsh web` still prints a URL carrying that token for supervisors and machine clients, but the browser it opens gets the clean URL. An unauthenticated index request now answers a self-contained `200 text/html` sign-in or setup page instead of 401 text. That page and the Settings panel post JSON to six routes this plugin owns beside `/connect`: `/auth/setup`, `/auth/login`, and `/auth/logout` serve an unsigned browser, while `/auth/state`, `/auth/change`, and `/auth/revoke` serve a signed-in one — a change proves the current password first, and a revoke signs out every other password-signed browser. Repeated failures per client address face a doubling wait capped at thirty seconds. The form asks for the password twice and offers **Remember me**, unchecked to end the session when the browser closes.

The password lives in the owner-scoped `client-connection/password` grant record as a scrypt digest plus a 32-byte `sessionEpoch`; `username` (default `dsh`) is a new config field naming the account a fresh setup form offers. Version `1` records stay readable and keep their sign-ins until a change or rotation rewrites them as version `2`. A browser cookie is version `v3` and carries the generation hashed from that record, or `launch` for a process-token exchange: changing the password or rotating the session retires password-signed cookies at once, `v1` cookies are refused, and API cookies stay version `v2`. `GET /connect?token=...` keeps its contract, so machine access and the desktop host stay password-free. Settings gains a **Sign-in** section above General, only on a page whose Host owns the session: it leads with the signed-in account, edits name and password behind that row, and lists **Sign out** and **Sign out other devices** underneath instead of in the panel header. Each authentication outcome logs one account-and-address line, never the password.

## Migration

1. Set the password on first visit; the caller that wins the record race chooses the name and the password. A later change proves the current password, so a forgotten one is still recovered by deleting the `client-connection/password` record and restarting.
2. Machine clients keep using the printed URL and `GET /connect?token=<launch-token>&interactions=none`. Browser automation reaching `/` signs in through `/auth/login` or keeps exchanging a launch token at the root.
3. Classify an index response by `content-type`, not status alone: `401 text/plain` is a refused token exchange, and `200 text/html` is the sign-in page. Callers constructing `BrowserAuth` pass a loaded `PasswordStore` as the fourth argument.
4. Set `username` on `@deepseek-ai/dsh-client-connection` for a different account name. The password itself never enters `cordis.yml`. Keep TLS configured for any authority reachable off the local machine: over plain HTTP the cookie and the submitted password travel unencrypted.
