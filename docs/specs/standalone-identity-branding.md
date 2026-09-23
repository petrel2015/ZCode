# Standalone identity and branding

Status: implemented. Covers the installable identity separation between the standalone distribution (this branch's nightly) and the official ZCode desktop builds, plus the rogue-nin battle-damaged mark used as its brand icon.

## Product contract

- The standalone distribution installs as **ZCode Standalone** and must coexist side by side with an official `ZCode` installation: different bundle ids, different app names, different user data directories, different Linux packages, different deep-link schemes, and different Finder/Explorer shell integrations. Neither installation may claim ownership of the other's registrations.
- Identity is selected at build time via `ZCODE_STANDALONE_IDENTITY=1` (same strict `1`/`0`/empty validation as `ZCODE_PREVIEW_IDENTITY`); it outranks the backend-env axis: a standalone build with `ZCODE_ENV=production` keeps production endpoints but takes the standalone identity.
- The single source of truth for identity is `desktopProductIdentities` in `packages/desktop/scripts/desktop-product-identity.mjs`. Runtime processes never re-derive it: electron-builder copies `zcodeProductFlavor`, `zcodeDeepLinkScheme`, and `zcodeLinuxExecutableName` into the packaged `package.json` (`extraMetadata`), and the main process reads that channel (`resolveDesktopRuntimeIdentity`). Dev fallback is the production identity.
- The brand mark is the "rogue ninja / battle-damaged" Z: the original black-squircle white italic Z with its two slice gaps, struck by a torn horizontal slash (missing-nin scratched-forehead-protector motif, monochrome), with battle damage (chips at stroke ends, cracks and debris around the slash, a chipped tile corner). Small sizes (≤64px) drop the damage detail and shorten the slash to stay legible. Source SVGs live in `packages/desktop/build/logo/`; `packages/desktop/scripts/generate-icon-assets.mjs` regenerates every packaged icon from them.

## Identity matrix

| Field                                           | production                                                      | standalone                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| appId / Windows AUMID                           | `dev.zcode.app`                                                 | `dev.zcode.standalone`                                                            |
| productName (`.app`, userData dir, install dir) | `ZCode`                                                         | `ZCode Standalone`                                                                |
| Linux executable / package                      | `zcode`                                                         | `zcode-standalone`                                                                |
| deep-link scheme                                | `zcode`                                                         | `zcode-standalone`                                                                |
| Finder workflow name / bundle id                | `Open in ZCode.workflow` / `dev.zcode.app.finder-open-workflow` | `Open in ZCode Standalone.workflow` / `dev.zcode.standalone.finder-open-workflow` |
| Linux user-level desktop entry                  | `zcode.desktop` / `x-scheme-handler/zcode`                      | `zcode-standalone.desktop` / `x-scheme-handler/zcode-standalone`                  |

Preview identity is unchanged.

## Ownership and boundaries

```mermaid
flowchart LR
  ENV["ZCODE_STANDALONE_IDENTITY=1"] --> ID["desktopProductIdentities.standalone<br/>(identity script)"]
  ID --> EB["electron-builder extraMetadata:<br/>zcodeProductFlavor / zcodeDeepLinkScheme / zcodeLinuxExecutableName"]
  EB --> RT["main: resolveDesktopRuntimeIdentity()"]
  RT --> DL["deep-link scheme registration<br/>(macOS setAsDefaultProtocolClient, Linux xdg)"]
  RT --> FW["Finder workflow + Explorer menu<br/>(name, bundle id, scheme, label)"]
  ID --> PK["packaging: productName / appId<br/>linux package names / Info.plist schemes"]
```

- The scheme string is owned by the identity table; no main-process module may hardcode `zcode://` for registration or generated shell scripts.
- Linux user-level registration never writes an entry whose desktop-file id equals another flavor's id, so AppImage/deb installations of the two products cannot shadow each other in XDG resolution.
- Icon assets are build inputs checked into `packages/desktop/build/`; runtime and CI never regenerate them during packaging.

## Acceptance cases

- With `ZCODE_STANDALONE_IDENTITY=1`: artifacts are named `ZCode Standalone-<version>-...`, the macOS bundle is `ZCode Standalone.app` with `CFBundleIdentifier=dev.zcode.standalone`, `CFBundleURLTypes` declares only `zcode-standalone`, and `codesign` shows `Identifier=dev.zcode.standalone`.
- `ZCode Standalone.app` and an official `ZCode.app` both installed: separate userData dirs, both launchable, `zcode://` still routes to the official app, `zcode-standalone://` routes to the standalone app.
- Linux: `zcode-standalone.desktop` / `zcode.desktop` coexist; installing one never deletes or shadows the other's registrations.
- Every packaged icon (icns/ico/png/AppImage icons, installer icons) and the in-UI marks (`logo-zai.svg`, `Z.svg`) render the battle-damaged slash-Z; at 32px the simplified variant stays recognizable.
- Without the env var, output is byte-for-byte the previous production identity (no filename or behavior drift for non-standalone builds).

## Validation record

- 2026-09-23: mockups iterated with pixel-level geometry checks and an external vision review; variant D (monochrome battle-damaged) selected by the product owner. Implementation and packaging validation recorded in the commit that adds the identity table entries and generated assets.
