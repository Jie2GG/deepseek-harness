# Agent Note: Models provider timeout field

Status: implemented

English | [中文](2026-11-10-models-provider-timeout-field.zh.md)

## Problem

A gateway mounted as a hand-declared `llm-pi-ai` route can hold a request open for ten minutes or more while it prefills a long context, because no token reaches the wire until prefill ends. Two deadlines bound that wait, one per layer: the adapter's stream idle watchdog (`streamIdleTimeoutMs`, 300 seconds by default) and the provider client the SDK layer uses (`timeoutMs`, ten minutes by default for the OpenAI and Anthropic clients pi-ai wraps). A request whose first token arrives later than the shorter of the two ends as a retryable `TIMEOUT`, and each retry prefills again. The Models settings page named neither key, so widening the wait for a slow gateway meant editing `cordis.patch.yml` by hand, and raising one key alone still lost the request to the other.

## Decision

- The create card for a custom model API carries an optional **Model timeout (seconds)** under the endpoint, and a hand-declared route's editor card carries the same field in the collapsed 自定义设置 fold beside its name and protocol. A filled value writes one whole millisecond count into both `providers.<route>.streamIdleTimeoutMs` and `providers.<route>.timeoutMs`; a blank field writes neither.
- One field owns both keys because they bound the same wait from two layers. A profile that raised only one still ends the request at the other, which is the failure mode the field exists to remove.
- The entered unit is seconds and no unit suffix is accepted. The stored form stays milliseconds because both profile keys, the adapter defaults, and the SDK options are millisecond-denominated; the entered form is seconds because the values an operator chooses are minutes long, and the smallest useful millisecond entry already needs four digits.
- On the editor card the placeholder is the layer the field falls back to — the composition entry's stored value, else the default the adapter's own schema resolves — and clearing the field unsets both keys. A profile that carries one key without the other renders `streamIdleTimeoutMs`, else `timeoutMs`, and is rewritten only when the field is touched, so a hand-written single-key profile survives an unrelated edit.
- Routes served from pi-ai's installed catalog and the `llm-deepseek` card show no such field. A shipped route's capacities come from its catalog entry, and a whole-section DeepSeek profile is a composition fact rather than a route this page created.

## Alternatives considered

**Write `streamIdleTimeoutMs` only.** The provider client keeps its own request bound, so an operator who entered a longer stream idle budget still receives `TIMEOUT` from the SDK and pays another prefill for it.

**Two fields, one per key.** Names the mapping directly, but asks the user to keep two numbers consistent for the same wait; any disagreement silently reintroduces the shorter bound, which is the failure being fixed.

**Raise the shipped defaults instead of adding a field.** Blunts stall detection for every route, so a wedged gateway waits out the new ceiling before it reports, and a default change is externally perceptible for a need only some gateways have.

**Milliseconds in the field.** Matches the stored form, but every value that matters is six digits long and one mistyped digit moves the deadline by an order of magnitude.

**Seconds with a unit suffix (`30m`, `1h`, `1800s`).** Reads well, but a parser that distinguishes `m` from `ms` and tolerates spacing and fractions is more surface than one labeled field avoids.

## Consequences

A route created or edited through the page now carries explicit millisecond values that shadow the adapter default until the field is cleared, and its slow-prefill budget is set from the browser instead of `cordis.patch.yml`. Retry policy, request image budgets, and profile `headers` remain configuration-only, and the field writes no session event: the two profile keys are its durable record.

## Testing

`packages/client/ui-settings-models/tests/timeout-value.client.spec.ts` covers the parser and the renderer, including blank, unit-suffixed, zero, negative, sub-millisecond, and over-ceiling input, and reads every accepted value back unchanged. `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` asserts that the create card writes both keys from one entry and neither when the field is blank, that an unreadable duration disables create and names the field, and that the editor card reads a stored pair back as seconds, rewrites both keys on an edit, unsets both on a clear, and leaves a hand-written single-key profile untouched. The Web flow `apps/web/tests/models-settings.e2e.ts` writes the field into a real settings document and compares the declared-route cards against their accessibility goldens.
