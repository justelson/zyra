# Contributing to Zyra

Thanks for helping improve Zyra. Contributions should keep the public project practical, local-first, privacy-safe, and easy to verify.

## Before opening a change

1. Read [`AGENTS.md`](AGENTS.md) for repository rules.
2. Use the [repository map](docs/repository-map.md) to find the owning area.
3. Check [current documentation](docs/README.md), the [public roadmap](docs/roadmap.md), and existing architecture decisions under [`docs/adr/`](docs/adr/).
4. Keep private `.zyra` state, sessions, memory, credentials, local exports, and personal profiles outside Git.
5. Prefer one focused change with a clear failure case and verification path.

## Development loop

1. Reproduce or describe the observable problem.
2. Inspect the current source of truth and its projections.
3. Make the smallest maintainable change.
4. Run the narrowest relevant test.
5. Run `npm run privacy-check` before proposing public changes.
6. Explain behavior, fallback, migration, and remaining assumptions in the pull request.

The repository default check is:

```bash
npm run check
```

It is intentionally broad. During development, use the focused scripts documented in `AGENTS.md` and the affected guide, then run the broader check when preparing a structurally significant change or release.

## Voice-agent architecture

The [Voice-Agent Architecture](docs/architecture/voice-agent/README.md) is a draft public specification. Architecture contributions should also read its focused [contribution guide](docs/architecture/voice-agent/CONTRIBUTING.md).

Run `npm run test:voice-agent-contracts` for schema/example changes. Provider proposals need public documentation or a redacted reproducible interoperability test. Keep generic API behavior separate from subscription product behavior, and mark implemented, experimental, proposed, unsupported, and unknown claims accurately.

## Privacy and security

Never commit:

- API keys, OAuth tokens, cookies, authorization headers, auth files, or pairing credentials;
- private sessions, memory, raw exports, personal profiles, or account identifiers;
- microphone recordings or unredacted screenshots;
- generated dependency/build directories;
- copied proprietary application code;
- prompts or fixtures that claim user approval.

Changes that widen tools, permissions, retention, network exposure, control authority, or model-visible context require a threat-model update and adversarial tests.

## Documentation

- Keep current guidance, architecture, implementation records, handoffs, and research in the locations defined by [`docs/README.md`](docs/README.md).
- Mark forward-looking work as Draft or Proposed.
- Add new release candidates and sanitized issue reports to the public roadmap. In related PRs, update the item's status, verification evidence, and release target; keep unreleased fixes distinct from shipped changes.
- Use Mermaid source for architecture diagrams and validate it before submission.
- Prefer official primary sources and include access dates for time-sensitive provider facts.
- Add or supersede an ADR for load-bearing architecture changes.

## Branch flow

- `master` is the stable integration and release line. It only accepts a tested patch, a release-ready minor/major batch, or an approved emergency fix.
- `dev` is the ongoing integration branch for normal iteration. Short-lived `feat/*`, `fix/*`, and `perf/*` branches target `dev` first.
- Release candidates may use `release/vX.Y.Z` while native packaging, signing, and publication gates are being completed.
- Promote a coherent batch from `dev` or a release branch to `master` through a pull request after its required checks pass. Failed CI, signing, notarization, updater, or publication gates are never bypassed.
- Keep ordinary experiments off `master`; do not use `dev` as an updater-visible release channel.

## Pull requests

A useful pull request states:

- the problem and affected user path;
- the source of truth and changed seams;
- behavior before and after;
- security/privacy implications;
- tests and exact results;
- migration and rollback;
- fallback behavior and known gaps.

Do not mix unrelated generated files, local state, or concurrent work into the commit.

## License

By intentionally submitting a contribution for inclusion in Zyra, you agree that it is licensed under the [Apache License 2.0](LICENSE), unless you explicitly mark material that cannot be contributed under those terms.
