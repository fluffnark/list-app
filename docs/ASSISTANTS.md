# Connect an assistant

The deployment is Tailscale-only. The client must be on Harmony’s tailnet or have an approved route into it. Cloud-hosted ChatGPT cannot reach this private endpoint; do not enable public Funnel merely to bypass that boundary.

The deployment serves:

- MCP: `https://harmony.great-kettle.ts.net:4443/listflow/mcp`
- OAuth issuer: `https://harmony.great-kettle.ts.net:4443/listflow`
- Protected-resource metadata: `https://harmony.great-kettle.ts.net:4443/listflow/.well-known/oauth-protected-resource`
- OpenAPI: `https://harmony.great-kettle.ts.net:4443/listflow/openapi.json`

OAuth supports dynamic client registration, authorization-code flow with S256 PKCE, explicit owner-password consent, one-time authorization codes, audience binding to the MCP resource, scoped one-hour access tokens, and rotating 30-day refresh tokens. It requests read-only access unless the client requests `listflow.write`. Revoking the current access token in Settings also prevents its refresh token from issuing replacements.

For clients that support custom bearer headers, create a scoped token in the web UI and add it to the MCP URL configuration. Do not use a personal Android-device token for an assistant; those have owner permissions.

For clients supporting remote MCP OAuth, add the MCP URL and follow their connection flow. ListFlow displays the requested access, exact redirect address, and the client name; the owner must enter the workspace password to approve. Client names are self-declared, so check the redirect address before authorizing.

The `query_items` tool supports `query`, `list_id`, `status`, `offset`, and `limit`. Writes require UUID idempotency keys, and updates require `base_version` from the latest item. The server attributes all mutations to the verified token holder. Bulk/destructive proposals remain pending until reviewed by the owner in Settings.

Neither a deployed MCP endpoint nor its tested OAuth flow means a connector has been installed into this particular ChatGPT/Codex session. That requires the account's client settings and authorization.

References: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [OAuth resource metadata](https://www.rfc-editor.org/rfc/rfc9728.html).
