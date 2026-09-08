# PI-30 OpenAI Codex usage API research

Date: 2026-09-08

## Confirmed implementation evidence

OpenAI's `codex` repository contains a Codex CLI usage client that requests:

```http
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <ChatGPT OAuth access token>
chatgpt-account-id: <ChatGPT account ID>
originator: codex_cli_rs
```

The account header routes a request for users with more than one ChatGPT account or organization. PI already stores this account ID for OpenAI Codex OAuth credentials and sends it for Codex model traffic.

The client declares this response shape:

```json
{
  "plan_type": "plus",
  "rate_limit": {
    "allowed": true,
    "limit_reached": false,
    "primary_window": {
      "used_percent": 12,
      "reset_at": 1750000000,
      "limit_window_seconds": 18000
    },
    "secondary_window": {
      "used_percent": 4,
      "reset_at": 1750400000,
      "limit_window_seconds": 604800
    }
  },
  "credits": {
    "has_credits": false,
    "unlimited": false,
    "balance": "0"
  }
}
```

`reset_at` is an absolute Unix timestamp in seconds. `limit_window_seconds` identifies the window duration, so PI should select the five-hour window by returned duration rather than provider field name or position.

Source: [OpenAI Codex CLI backend client](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs).

## API status

OpenAI's Codex authentication documentation supports signing in with ChatGPT, but does not document the `/backend-api/wham/usage` endpoint, its request headers, or its response contract. OpenAI's documented Usage API concerns API-platform organization usage, not ChatGPT subscription quotas.

Sources:

- [Codex authentication](https://developers.openai.com/codex/auth/)
- [OpenAI Usage API](https://platform.openai.com/docs/api-reference/usage)

## Recommendation

Use this endpoint only as optional, best-effort telemetry. It must fail closed on missing or malformed fields, cache and deduplicate requests, and never make billing, authorization, or access-control decisions. PI-30's existing silent-degradation criteria fit this constraint.

## Decision required

The endpoint is undocumented. Maintainer approval is required before PI uses it and identifies the request as Codex CLI. The approval should also define whether `credits.has_credits`, `credits.unlimited`, and `plan_type` exclude a report when a finite rate-limit window is present.
