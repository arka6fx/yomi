# Dodo Live Webhook Validation Report

Date: 2026-06-13

## Scope

Validate end-to-end Dodo live webhook readiness for Yomi production billing.

Webhook endpoint:

```text
https://api.yomi.arka6fx.com/api/billing/webhook
```

## Production Configuration

Verified in Cloudflare Workers production bindings:

- `DODO_ENV=live`
- `DODO_LIVE_WEBHOOK_SECRET` is present as a secret binding
- `DODO_LIVE_API_KEY` is present as a secret binding
- All required live product ID bindings are present as secret bindings

Secret value equality with the Dodo dashboard cannot be read back from Cloudflare. It must be confirmed by a signed Dodo webhook delivery succeeding.

## Logging Deployed

Production backend version deployed with detailed secret-safe webhook logging:

```text
0400eec9-e17e-428f-9402-7a9f21b5790b
```

The webhook handler now logs:

- request received
- signature verification result
- event type
- event id
- processing result
- response status

No webhook body, API key, webhook secret, or customer payment details are logged.

## Endpoint Reachability

Manual unsigned request:

```bash
curl -i -X POST https://api.yomi.arka6fx.com/api/billing/webhook \
  -H "Content-Type: application/json" \
  --data "{}"
```

Observed response:

```http
HTTP/1.1 400 Bad Request
```

Observed body:

```json
{"error":"Invalid signature"}
```

Interpretation:

- Endpoint is reachable.
- Route is deployed.
- Signature verification is active.
- Unsigned/spoofed requests are rejected.

## Backend Health

Production health endpoint:

```text
https://api.yomi.arka6fx.com/health
```

Observed response:

```json
{"status":"ok","version":"0.1.0"}
```

## Expected Cloudflare Log Sequence

For a valid Dodo signed webhook, Cloudflare logs should show:

```text
[yomi/billing/webhook] received { ... }
[yomi/billing/webhook] signature_verification { "valid": true, ... }
[yomi/billing/webhook] event_parsed { "eventType": "...", "eventId": "..." }
[yomi/billing/webhook] processing_result { "result": "processed", ... }
[yomi/billing/webhook] response { "status": 200, "result": "processed", ... }
```

Duplicate event deliveries should show:

```text
[yomi/billing/webhook] processing_result { "result": "deduplicated", ... }
[yomi/billing/webhook] response { "status": 200, "result": "deduplicated", ... }
```

Invalid signatures should show:

```text
[yomi/billing/webhook] signature_verification { "valid": false, ... }
[yomi/billing/webhook] response { "status": 400, "result": "invalid_signature", ... }
```

## Live Event Validation

Not yet completed in this report. Requires one of:

- Option A: Purchase Yomi Credits 500 using a real payment method.
- Option B: Send a live signed test event from the Dodo dashboard webhook testing tool.

Expected successful flow:

```text
Dodo -> POST webhook -> Yomi receives request -> signature valid -> event parsed -> business logic executed -> 200 OK
```

## Success Criteria

Pending live Dodo event must confirm:

- Cloudflare logs show request received.
- Cloudflare logs show signature valid.
- Cloudflare logs show event parsed.
- Cloudflare logs show response status 200.
- Dodo dashboard delivery shows succeeded.
- Dodo webhook page shows at least one message received.

## Current Status

Ready for live signed webhook test.

Unsigned endpoint validation passed. Production is configured for Dodo live mode and has the live webhook secret binding present. End-to-end delivery can be marked complete after Dodo sends a signed live webhook and reports delivery success.
