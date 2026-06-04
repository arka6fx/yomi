# Desktop Build Resources

Electron Builder reads installer assets from this folder.

- `icon.ico` is used by the Windows installer and app executable.
- `win-sign-noop.cjs` keeps local unsigned packages from requiring Windows signing helper
  symlinks. Replace it with real certificate signing in CI before public release.
- macOS and Linux icons should be added here before enabling signed builds for those targets.
