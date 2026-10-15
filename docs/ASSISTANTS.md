# Connect an assistant

The encrypted deployment uses private Tailscale HTTPS. The owner also enabled a LAN-only HTTP browser endpoint; use HTTPS for assistant connections. Direct HTTPS clients must be on Harmony’s tailnet. Cloud-hosted ChatGPT can use an explicitly configured OpenAI Secure MCP Tunnel; it cannot directly reach the private URL. Keep public Funnel disabled for ListFlow.

The deployment serves:

- MCP: `https://harmony.great-kettle.ts.net:4443/listflow/mcp`
- OAuth issuer: `https://harmony.great-kettle.ts.net:4443/listflow`
- Protected-resource metadata: `https://harmony.great-kettle.ts.net:4443/listflow/.well-known/oauth-protected-resource`
- OpenAPI: `https://harmony.great-kettle.ts.net:4443/listflow/openapi.json`

OAuth supports dynamic client registration, authorization-code flow with S256 PKCE, explicit owner-password consent, one-time authorization codes, audience binding to the MCP resource, scoped one-hour access tokens, and rotating 30-day refresh tokens. It requests read-only access unless the client requests `listflow.write`. Revoking the current access token in Settings also prevents its refresh token from issuing replacements.

For clients that support custom bearer headers, create a scoped token in the web UI and add it to the MCP URL configuration. Do not use a personal Android-device token for an assistant; those have owner permissions.

For clients supporting remote MCP OAuth, add the MCP URL and follow their connection flow. ListFlow displays the requested access, exact redirect address, and the client name; the owner must enter the workspace password to approve. Client names are self-declared, so check the redirect address before authorizing.

The `query_items` tool supports `query`, `type`, `list_id`, `status`, `offset`, and `limit`. Writes require UUID idempotency keys, and updates require `base_version` from the latest item. The server attributes all mutations to the verified token holder. Bulk/destructive proposals remain pending until reviewed by the owner in Settings.

Neither a deployed MCP endpoint nor its tested OAuth flow means a connector has been installed into this particular ChatGPT/Codex session. That requires the account's client settings and authorization.

References: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [OAuth resource metadata](https://www.rfc-editor.org/rfc/rfc9728.html).


## ChatGPT live notes connection

Use the existing ListFlow MCP service through [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). This preserves private hosting and sends only authorized tool requests and responses through OpenAI. Tunnel availability, permissions and any account charges must be checked in the target account; this guide does not claim a free service or an activated connection.

1. In [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels), create or select a tunnel associated with the intended ChatGPT workspace. Obtain a restricted runtime key with Tunnels Read + Use; do not paste the key into chat.
2. On Harmony, install the ARM64 client from the download offered in Platform or the [latest official release](https://github.com/openai/tunnel-client/releases/latest). Run `tunnel-client help quickstart` and use its current HTTP configuration commands, with profile `listflow`, the actual tunnel ID, and MCP URL `https://harmony.great-kettle.ts.net:4443/listflow/mcp`. Supply the runtime key through `CONTROL_PLANE_API_KEY` using a protected service environment or secure local input. Keep the admin UI on loopback and raw HTTP logging disabled.
3. Run `tunnel-client doctor --profile listflow --explain`, then `tunnel-client run --profile listflow`. A persistent Harmony service should be installed after successful account configuration. No listener or Funnel change is needed.
4. In ChatGPT Plugins/Apps, add a custom MCP server, choose Connection: Tunnel, select that tunnel and configure OAuth. Request both `listflow.read` and `listflow.write`. The consent browser must be on Tailscale to reach ListFlow’s private authorization page. Tunnel transport does not automatically tunnel OAuth endpoints; verify discovery/token exchange before assuming this works. If the client cannot complete private OAuth, use a revocable, non-device read/write assistant token only if that client offers an authenticated token configuration. Never disable ListFlow authentication to work around this.
5. Load the accompanying `integrations/chatgpt/skills/listflow-notes/SKILL.md` as workflow instructions using the skill/plugin interface available in the account. The portable `plugin.json` package contains instructions only; it does not register an MCP connection. For accounts without skill upload, paste `integrations/chatgpt/CONTEXT.txt` into project instructions and attach the connected ListFlow app.
6. Verify from ChatGPT: query notes; create one clearly labeled connection-test note with a body; edit it using its returned version; confirm it arrives in the phone after sync. Record results before calling access complete. Test-note deletion uses the normal reviewed bulk-change workflow.

The current assistant OAuth grant permits workspace-wide read/edit, not an enforced notes-only security boundary. The notes skill limits its workflow to notes; it does not narrow server authorization. Use only with your trusted personal account. Bulk/destructive changes remain subject to owner review.

## Google Sheets alternative

[ChatGPT’s Google Drive app](https://help.openai.com/en/articles/10929079-google-drive-app-and-setup-in-chatgpt) supports Sheets access and permitted write actions. This does not establish a ListFlow connection. ListFlow’s current Sheets integration projects the operation ledger into a spreadsheet; it detects external changes but does not import cell edits. Use Sheets for reading exported context only until a validated operation-import path exists. Directly editing Items or OperationLog would bypass conflict handling and can be replaced during projection repair.

At the time this guide was updated, Harmony reported Google OAuth unconfigured (`/api/config` returned `google: false`), so no live Sheets connection was verified. The secure tunnel is also not yet configured in the account. Browser/computer-use surfaces were unavailable to this coding session.


Tunnel setup update: the owner supplied a tunnel ID, retained only in Harmony’s local configuration. As of this check, the official tunnel guide and API pricing page did not state an explicit zero-price guarantee. Do not activate the client until the account’s terms confirm no additional charge. Runtime credentials and ChatGPT-account connection are still pending; no inference API calls or billing changes were made.

Harmony preparation completed: installed the official ARM64 tunnel-client v0.0.16 after verifying its SHA-256 against GitHub release metadata; initialized the `listflow` OAuth/DCR profile in `~/.config/tunnel-client/listflow.yaml` with the supplied tunnel ID and private HTTPS MCP URL. The profile is mode 0600. No polling daemon was started, no runtime key was supplied, and no model/API inference request was made. Computer-use account verification remains unavailable (`CUA_REPL_ENABLED_SURFACES is required`).
