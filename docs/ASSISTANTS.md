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

Use the existing ListFlow MCP service through [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). This preserves private hosting and sends authorized tool traffic through OpenAI. The transport is running; account-side ChatGPT installation and a tool-call round trip are still pending. No free-price guarantee is claimed.

1. In [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels), create or select a tunnel associated with the intended ChatGPT workspace. Obtain a restricted runtime key with Tunnels Read + Use; do not paste the key into chat.
2. On Harmony, install the ARM64 client from the download offered in Platform or the [latest official release](https://github.com/openai/tunnel-client/releases/latest). Run `tunnel-client help quickstart` and use its current HTTP configuration commands, with profile `listflow`, the actual tunnel ID, and MCP URL `https://harmony.great-kettle.ts.net:4443/listflow/mcp`. Use a protected key-file reference (the deployed profile uses `file:/home/harmony/.config/tunnel-client/listflow-runtime-key`) or a protected service environment. Keep the admin UI on loopback and raw HTTP logging disabled.
3. Run `tunnel-client doctor --profile listflow --explain`, then `tunnel-client run --profile listflow`. A persistent Harmony service should be installed after successful account configuration. No listener or Funnel change is needed.
4. In ChatGPT Plugins/Apps, add a custom MCP server, choose Connection: Tunnel, select that tunnel and configure OAuth. Request both `listflow.read` and `listflow.write`. The consent browser must be on Tailscale to reach ListFlow’s private authorization page. Tunnel transport does not automatically tunnel OAuth endpoints; verify discovery/token exchange before assuming this works. If the client cannot complete private OAuth, use a revocable, non-device read/write assistant token only if that client offers an authenticated token configuration. Never disable ListFlow authentication to work around this.
5. Load the accompanying `integrations/chatgpt/skills/listflow-notes/SKILL.md` as workflow instructions using the skill/plugin interface available in the account. The portable `plugin.json` package contains instructions only; it does not register an MCP connection. For accounts without skill upload, paste `integrations/chatgpt/CONTEXT.txt` into project instructions and attach the connected ListFlow app.
6. Verify from ChatGPT: query notes; create one clearly labeled connection-test note with a body; edit it using its returned version; confirm it arrives in the phone after sync. Record results before calling access complete. Test-note deletion uses the normal reviewed bulk-change workflow.

The current assistant OAuth grant permits workspace-wide read/edit, not an enforced notes-only security boundary. The notes skill limits its workflow to notes; it does not narrow server authorization. Use only with your trusted personal account. Bulk/destructive changes remain subject to owner review.

## Google Sheets alternative

[ChatGPT’s Google Drive app](https://help.openai.com/en/articles/10929079-google-drive-app-and-setup-in-chatgpt) supports Sheets access and permitted write actions. This does not establish a ListFlow connection. ListFlow’s current Sheets integration projects the operation ledger into a spreadsheet; it detects external changes but does not import cell edits. Use Sheets for reading exported context only until a validated operation-import path exists. Directly editing Items or OperationLog would bypass conflict handling and can be replaced during projection repair.

Harmony currently reports Google OAuth unconfigured (`/api/config` returns `google: false`), so no live Sheets connection has been verified. Browser/computer-use surfaces are unavailable to this coding session.

## Observed tunnel status

The official ARM64 client v0.0.16 is installed on Harmony, with its SHA-256 verified against official release metadata. The owner supplied the tunnel ID and saved the runtime credential using hidden terminal entry. The profile and key are mode 0600; only a file reference appears in the profile. The tunnel metadata confirms association with a ChatGPT workspace and Platform organization.

`tunnel-client doctor --profile listflow --json` passes. The tunnel is now managed by `listflow-tunnel.service`, enabled at boot with restart-on-failure. Both `/healthz` and `/readyz` return 200, OAuth discovery completes, and the control plane polls. The unauthenticated MCP startup probe receives 401 as expected; readiness does not prove a signed-in ChatGPT tool call has succeeded. The loopback admin address is written to `~/.local/state/tunnel-client/health/listflow.url`. Its admin UI has not been exposed on the LAN or Funnel.

The owner reported a free-tier account and asked to continue setup. No billing configuration, plan upgrade, credit purchase, or model inference API request was performed. Public docs do not establish a guaranteed zero price for tunnel transport; account tier alone is not proof of pricing. Do not add paid services as a workaround.

Remaining account step: add the associated tunnel as a custom MCP server in ChatGPT, choose OAuth, complete owner consent and install it in a conversation. A successful read/create/edit note call in ChatGPT remains required before claiming end-to-end access. No ListFlow tools are currently exposed in this coding session.

### Hidden runtime-key entry

A local helper is installed on Harmony. After creating a restricted runtime key with only Tunnels Read + Use in the intended OpenAI organization, run:

```bash
ssh -t harmony '~/.local/bin/listflow-tunnel-key'
```

Paste the key at the hidden prompt. It saves `~/.config/tunnel-client/listflow-runtime-key` mode 0600, outside the repo, and does not start the tunnel. Do not paste a key into chat. The helper is reproducible from `scripts/save-tunnel-key.py`.

The current operator diagnostic is `tunnel-client doctor --profile listflow --explain`. The key-file reference is already configured in the profile; no secret environment variable is needed. Do not enable billing, top up credits, change plans, or invoke model APIs as a workaround for missing access. Platform/API tier is separate from the ChatGPT account’s ability to install a custom MCP connection.
