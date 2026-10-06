# Zyra privacy policy

Last updated: October 6, 2026

This policy covers Zyra Desktop and the terminal application. The [Zyra Browser policy](zyra-browser.md) also applies when you use the Chrome companion. Zyra is an open-source application maintained through [justelson/zyra](https://github.com/justelson/zyra).

## Local information and your chosen services

Zyra stores conversations, attachments, settings, project context, memory and credentials on your computer. Some information is stored in Zyra's application profile and some in the workspace or configured data directory. These records remain until you remove them or change the relevant settings; uninstalling the application may preserve them.

When you send a request, Zyra sends the information needed for that request to your selected AI provider. This can include prompts, conversation history, attachments, project context, file contents and tool results. A title-generation request can also send conversation context to the configured provider. Local storage does not mean the assistant operates without external processing.

Tools, plugins, connected services and remote agent connections may receive additional information needed for the actions you authorize. Those destinations depend on your configuration and request. Their own privacy policies, account settings and retention rules apply. Review them before sharing sensitive information. Zyra does not sell conversation or browsing information or use it for advertising.

Credentials are kept in local authentication storage and used to authenticate to the selected service. Do not assume that every local record is encrypted. Protect your operating-system account, devices, backups and workspace permissions.

## Browser, computer and voice assistance

Browser and computer assistance can observe tab titles, URLs, page text, screenshots and other information visible on the surfaces you share. Authorized tools can interact with those surfaces and return observations to your assistant. Visible screenshots may contain personal or confidential information.

Voice features use microphone audio and may send audio or transcripts to the provider configured for the feature. Connected services may process documents, messages or other content needed for a requested action. Select the access and permission mode appropriate for your task; broader access allows the assistant to use more information and tools.

The Chrome companion connects to Desktop on your computer through a loopback connection. It does not operate a separate hosted browser-data service. Requests entered there use the same configured Desktop providers and tools.

## Optional product analytics

Product analytics are disabled by default. If you enable them, Zyra sends an allowlisted set of feature-use, performance and categorized error events to PostHog. Release builds include a public PostHog project destination; an approved configuration can override it. A random installation identifier links these events without deriving identity from your account, email, device name or project.

Analytics excludes prompts, responses, transcripts, file contents, paths, project names, URLs, browser history, credentials, clipboard contents, terminal contents, raw exception messages and stack traces. Zyra does not include PostHog browser autocapture, session replay or heatmaps. See the [analytics data contract](../architecture/product-analytics.md) and [privacy controls](../security/product-analytics.md).

The local analytics queue discards events older than seven days. Turning analytics off stops new collection and clears pending events; an already transmitted request may finish. A previously created random installation identifier can remain locally for re-enabling analytics. Remote retention and deletion are managed by the PostHog project; this policy does not promise that disabling analytics deletes events already received by it.

## Network requests beyond your prompts

Desktop update checks and release downloads contact GitHub or the configured release service. The embedded CastLabs Electron runtime can automatically download and update the Widevine media component from Google for protected web playback. Zyra does not bundle that component in its installer. These requests can occur without an AI prompt.

Browser blocking features can download filter lists when enabled. Provider catalogs, plugins, extensions and other optional features may contact their configured services when you use them. Websites opened in the integrated browser make their own requests and may store cookies or site data.

Network recipients normally receive connection information such as your IP address and request time. Application-level exclusions do not remove all network metadata. The source requires the analytics project to disable IP capture; this is an administrative setting, not a guarantee that network infrastructure never processes an IP address.

## Installation and your controls

The stable Windows Desktop installer installs the app and bundled runtime, registers Explorer "Open with Zyra" actions and file-type icons, and adds a per-user `zyra` terminal launcher to your user PATH. Uninstall removes Zyra's app and Explorer integration; shared terminal components, PATH entries or user data may remain where another installation still uses them or cleanup does not remove them. Development previews use a separate application profile and do not install the stable Explorer or PATH integration.

You can choose providers and tools, limit browser sharing, change permission modes, turn analytics off in Desktop Settings or with `/analytics off`, and remove conversations through the application's available controls. Disconnecting a service stops future authorized use; it does not delete information already processed by that service.

For a complete local removal, review the configured data locations and any project-local Zyra data after uninstalling. Remove only the records you intend to discard. Copies in backups, exports and external providers require separate deletion. Information you post in public GitHub issues or discussions is also public and subject to GitHub's policies.

## Changes and contact

This policy will be updated when Zyra's data handling changes. The date above identifies the revision. For privacy questions, contact the maintainer through [the project issue tracker](https://github.com/justelson/zyra/issues). Keep public reports free of private conversations, credentials, account details and screenshots containing sensitive information; ask for a suitable private reporting route when needed.
