# Spec 13 - Pricing

Plans:

| Plan | Price | Main limits |
| --- | --- | --- |
| Explore | $0/mo | Trial/free usage, basic voice/screen, limited memory, 2 connectors |
| Pro | $14.99/mo | Higher chats, voice/screen, memory, 8 connectors |
| Max | $39.99/mo | Highest fair-use limits, 8 connectors |

Fair use is always bounded. Usage is metered through backend `usage_events` and credit transactions.

Billing provider: Dodo Payments. USD is canonical; India-local display prices are configured separately.
