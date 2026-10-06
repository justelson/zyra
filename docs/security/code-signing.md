# Zyra code signing policy

Last updated: October 6, 2026

**Status: proposed SignPath Foundation integration; approval and signing setup are pending.** Current Windows release and development-preview installers are unsigned. Preparing an application does not make an existing download signed or certify that it is safe.

## Responsibility and approval

The public source repository is [justelson/zyra](https://github.com/justelson/zyra). The project is maintained by [@justelson](https://github.com/justelson), who currently performs the committer, reviewer and release-approver roles. These are not independent people. The [elsondev2/zyra helper repository](https://github.com/elsondev2/zyra) supplies build automation under the same maintainer's control; its account is not a separate human reviewer.

Before signing is enabled, every account with source, workflow, artifact or signing-policy write access must use multi-factor authentication. Signing releases requires explicit approval by the maintainer. Additional committers, reviewers or approvers must be listed here before receiving signing-related authority.

## What may be signed

The intended Windows scope is Zyra-owned release executables: Desktop, its installer and uninstaller, the bundled Zyra computer-use helper, and the standalone Windows TUI. The final target list must be agreed with SignPath and verified against an installed build. Upstream runtimes and third-party libraries keep their original identities and licenses; this policy does not authorize signing arbitrary third-party executables as Zyra.

Zyra's code is Apache-2.0. Distributed dependencies and assets retain their own licenses and notices, described in [third-party notices](../../THIRD_PARTY_NOTICES.md). The CastLabs Electron runtime is open source. Widevine is a separate Google-provided component that can be automatically downloaded and updated on the user's device; Zyra does not bundle or redistribute it. SignPath's acceptance of that arrangement must be confirmed before integration.

Windows Authenticode signing does not replace CastLabs protected-media/VMP authorization. macOS signing and notarization use Apple's separate certificate and verification requirements.

## Source and build verification

Only artifacts from an approved GitHub-hosted build, tied to a reviewed source commit and the approved workflow, may be submitted for release signing. Arbitrary local uploads are outside this policy. Release review must identify the source repository, source commit, workflow repository, workflow commit, run and artifact used.

The present helper arrangement can build source from `justelson/zyra` using workflow code in `elsondev2/zyra`. Both commits must be pinned and checked. This arrangement requires SignPath origin-verification approval; an artifact manifest by itself is not proof that the service accepts the build's origin.

Stable releases and development previews have separate distribution and update policies. Signing a stable release does not automatically authorize preview signing. Until a preview signing policy is explicitly approved and configured, previews remain clearly labeled unsigned development builds.

## Gates before the first signed release

- Confirm SignPath eligibility, the helper build arrangement and the separate Widevine component behavior.
- Confirm MFA on all participating GitHub and SignPath accounts and configure the approved signing policies with manual release approval.
- Present the [privacy policy](../privacy/zyra.md) and material installation changes before installation; verify the actual installer flow as well as the download-page disclosure.
- Verify publisher, product and version metadata on Zyra-owned binaries, including the Windows computer-use helper.
- Integrate signing into the real packaging workflow and verify the installed targets, installer and uninstaller. Generate final checksums and updater metadata after all transformations and signing.
- Check the required signing attribution and certificate status before publishing the release.

These are pending gates, not claims about controls already deployed.

## Attribution and certificate identity

If the project is accepted, its download documentation will carry the required attribution:

> Free code signing provided by SignPath.io, certificate by SignPath Foundation

This is the intended attribution after approval; SignPath sponsorship is not yet active. Foundation-issued certificates identify **SignPath Foundation**, rather than a private certificate in the maintainer's name. Certificates may be revoked under the Foundation's rules.

For the service requirements, see the [SignPath Foundation terms](https://signpath.org/terms.html) and [trusted GitHub builds documentation](https://docs.signpath.io/trusted-build-systems/github). Report suspected unauthorized Zyra releases through [the project](https://github.com/justelson/zyra/issues), without posting credentials or private data.
