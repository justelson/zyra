# Multiple ChatGPT accounts

Open **Settings > Providers > Limits** to add and manage ChatGPT sign-ins. Each account keeps its own OAuth credentials. Signing into an account that is already connected updates that account without replacing the others.

The default **Automatic balance** strategy favors accounts with more remaining usage, rotates accounts with similar remaining usage, and spreads concurrent requests. Zyra checks reported limit reset timestamps before selecting an account. An exhausted short or long window prevents selection until every exhausted window has reset.

You can choose **Rotate evenly** or **Drain one account first** instead. Drain-first uses your preferred eligible account, then falls back to another eligible account when necessary. It returns to the preferred account after its limit resets.

Pause an account with its toggle, or choose **Selected accounts only** to restrict requests to a specific set. An empty selection allows no account. Zyra never falls back outside that selection. Changes apply to subsequent requests; an already streaming response finishes on its original account.

Usage refreshes while Limits is visible and, at most once per minute, in the background when subscription requests are sent. HTTP response limit headers also update the selected account's quota. If a usage check fails, Zyra retains the last known values rather than inventing fresh quota. Old windows become eligible after their recorded reset; fresh requests and checks update them.

If an account returns an authentication or quota error before any response content starts, Zyra tries another allowed account. It attempts each eligible identity at most once. After text, reasoning, or tool-call events start, it surfaces the error without replaying the response on another account. Model access failures temporarily exclude that account for the requested model; Zyra keeps the selected model.

**Sign in again** reconnects that exact account. A different identity is rejected and existing connections are preserved. **Disconnect account** removes only the selected sign-in; removing the primary promotes a remaining account. Disconnecting the last account uses the existing OpenAI disconnect flow and updates the default connection when needed.

The existing identity and banked-reset sections below the account pool refer to the primary account. Pooling applies to subscription model requests. API-key connections and ChatGPT Voice keep their existing paths.

## Usage page

Open **Settings > Providers > Usage** for local activity across Zyra, Codex, Claude Code, OpenCode, Pi, DevScope, and Zyra CLI. Choose Cost or Tokens, a source, and 7/30/90 days, one year, or all time. The chart supports daily, weekly, and cumulative views; Tokens also has the activity view. The breakdown groups by model, day, tool, or provider.

Cost combines recorded model costs and API-equivalent estimates; it is not a subscription bill. Counts refer to usage records. Unpriced and unmetered records stay visible, and an asterisk marks partial measurements. Source coverage and indexing details are in the source menu.

The Limits tab keeps account quotas, routing, and banked resets together. Its toolbar refresh waits for account quotas and the primary account overview. Account names default to saved random aliases; use the pencil to rename one, or click the name to reveal its email temporarily.
