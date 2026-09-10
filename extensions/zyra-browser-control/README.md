# Zyra Browser

The Chrome companion to the installed Zyra app. It shares only tabs selected in the extension, with Read or Control access. No separate bridge server, MCP setup, or browser skill is needed.

## Connect

1. In Zyra, open **Settings → Device connections → Chrome browser**.
2. Choose **Extension folder**. In Chrome's `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select that folder. The extension is bundled with the app; Chrome Web Store publication is separate.
3. Choose **Connect Chrome** in Zyra. In the extension, enter the eight-digit code and port, and accept Chrome's request for a connection to the local app.
4. Select Read or Control for the desired tabs. Ask Zyra to use Chrome. Disconnect or release access from either surface.

Normal in-app Browser tabs use the saved Zyra profile. Incognito remains an explicit choice. Chrome private tabs cannot be shared.

## Architecture

`pairing.ts` owns the existing app HTTP challenge/proof and rotating-token transport. `service-worker.ts` owns connection/UI lifecycle and cancellation. `app-controller.ts` maps broker observations and actions to the controller's opaque page references. `extension/control.ts` uses Chrome's debugger protocol for trusted input; `page.ts` inspects the exact granted origin in an isolated world. The popup and console share React components in `ui/`.

The desktop broker still owns chat approvals, capabilities, action budgets, revisions and critical side effects. Read-only extension access also rejects input. Same-origin navigation retains tab sharing but invalidates old element references. Changed-origin navigation releases sharing. Worker restart retains a valid connection but never restores input grants. Late/expired input is never replayed. Pointer strokes preserve every supplied point, require an active tab, and can automatically focus that tab only when the broker grant includes `window.focus`.

The default Follow Zyra theme consumes only an allowlist of appearance preferences. Theme and accent definitions import the app's canonical source at build time, preventing a second independently maintained palette.

## Development

```sh
npm ci --prefix extensions/zyra-browser-control
npm --prefix extensions/zyra-browser-control run typecheck
npm --prefix extensions/zyra-browser-control test
npm --prefix extensions/zyra-browser-control run package
```

`dist/unpacked` and the deterministic `dist/zyra-browser-control.zip` are generated. Release preparation installs the pinned dependencies and builds both. No generated bundles, browser profiles, tokens, or captures belong in Git.
