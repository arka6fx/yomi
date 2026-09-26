# Apps

| App                    | What it is                                            | Deploys to       |
| ---------------------- | ----------------------------------------------------- | ---------------- |
| [`api`](./api)         | FastAPI backend, Cloudflare Workers, D1 migrations    | `api.getyomi.in` |
| [`web`](./web)         | Next.js marketing site and dashboard                  | `getyomi.in`     |
| [`sandbox`](./sandbox) | Computer-use desktop (Chrome in a Cloudflare Sandbox) | `yomi-computer`  |

Each app deploys on its own when a push to `main` touches its folder.
