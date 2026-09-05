# Plugin logos

These are local copies of the catalog's official logos. `sources.json` records each source page, image URL, byte count, and SHA-256 digest. Brand marks belong to their respective owners; the repository's code license does not grant rights to those marks.

Most images come from the commit-pinned OpenAI Plugin repository. When its Plugin manifest omits a logo, `desktop/src/shared/plugins/plugin-logo-overrides.json` records an official publisher asset. Adobe's mark comes from its published Skill assets; Lovable, Consensus, and Higgsfield use icons published by their own sites.

Refresh deliberately from the repository root:

```sh
node --dns-result-order=ipv4first scripts/update-plugin-logos.mjs
```

The script downloads images only, validates bounded image formats, and generates `pages/plugins/bundled-plugin-logos.ts`. It does not install or execute Plugins. Catalog refresh and logo refresh are separate maintainer actions. Runtime rendering uses bundled URLs and makes no remote logo requests.
