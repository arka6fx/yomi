# Plan: Public Release Distribution via yomi-releases

## Context

The `arka6fx/yomi` repo is now private. All download links on the landing page and in electron-builder point to `github.com/arka6fx/yomi/releases`, which is inaccessible to the public. We need to redirect all release distribution to the newly created public repo `arka6fx/yomi-releases`.

**Repo created:** https://github.com/arka6fx/yomi-releases (public)

---

## Changes

### 1. Update `/download` page API + links

**File:** `apps/landing/src/app/download/page.tsx`

- Line 5: `api.github.com/repos/arka6fx/yomi/releases/latest` → `api.github.com/repos/arka6fx/yomi-releases/releases/latest`
- Line 42: `github.com/arka6fx/yomi/releases` → `github.com/arka6fx/yomi-releases/releases`
- Line 134: `github.com/arka6fx/yomi/releases` → `github.com/arka6fx/yomi-releases/releases`

### 2. Update landing page `#download` section

**File:** `apps/landing/src/components/landing/landing-page.tsx`

- Lines 76-81: Replace both Windows options with a single `.exe` installer pointing to `github.com/arka6fx/yomi-releases/releases/latest` (remove MSI — it was never built)
- Line 710: `github.com/arka6fx/yomi/releases` → `github.com/arka6fx/yomi-releases/releases`

### 3. Update electron-builder publish config

**File:** `apps/desktop/electron-builder.yml`

- Lines 64-66: Add `owner: arka6fx` and `repo: yomi-releases` to the publish block so `electron-builder --publish` targets the correct repo

### 4. Create release CI workflow

**File:** `.github/workflows/release.yml` (new)

- Trigger: `workflow_dispatch` only (manual)
- Runs on: `windows-latest` (needed for NSIS + sidecar .exe compilation)
- Steps:
  1. Checkout code
  2. Setup Bun
  3. Install deps (`bun install`)
  4. Build sidecar (`bun --filter @yomi/sidecar build`)
  5. Setup .NET SDK (for UIA helper)
  6. Build UIA helper (`bun --filter @yomi/uia-helper build`)
  7. Build Electron app + installer (`electron-vite build && electron-builder --win --publish always`)
  8. Upload installer artifact to the workflow run as backup
- The `--publish always` flag tells electron-builder to create a GitHub Release on `arka6fx/yomi-releases` and upload the `.exe` installer
- Requires `GH_TOKEN` secret scoped to the `yomi-releases` repo (a PAT with `repo` scope)

### 5. Dashboard download link — no change needed

The dashboard at `apps/landing/src/app/dashboard/page.tsx:384` links to `/#download` (scrolls to homepage section), so it inherits the updated URLs automatically.

---

## Secrets Required

| Secret | Where | Purpose |
|---|---|---|
| `GH_TOKEN` | `arka6fx/yomi` repo secrets | PAT with `repo` scope so electron-builder can publish to `yomi-releases` |

---

## Verification

1. `bun run lint` — passes
2. `bun run typecheck` — passes
3. `bun run build:ci` — passes (landing + sidecar compile)
4. Manual: trigger the release workflow → confirm `.exe` appears on `github.com/arka6fx/yomi-releases/releases`
5. Manual: visit `yomi.arka6fx.com/download` → confirm version, size, and download button work
