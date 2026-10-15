import express from "express";
import rateLimit from "express-rate-limit";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Store } from "./store";
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
const random = () => randomBytes(32).toString("base64url");
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function oauthRouter(
  store: Store,
  issuer: string,
  verifyPassword: (password: string) => boolean,
  options: { resourceAliases?: string[]; browserOrigins?: string[] } = {},
) {
  const router = express.Router();
  const resource = issuer + "/mcp";
  const resources = new Set([resource, ...(options.resourceAliases || [])]);
  const consentPath = new URL(issuer).pathname.replace(/\/$/, "");
  router.use(express.urlencoded({ extended: false, limit: "16kb" }));
  router.use(
    "/oauth",
    rateLimit({
      windowMs: 60000,
      limit: 40,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  const metadata = {
    issuer,
    authorization_endpoint: issuer + "/oauth/authorize",
    token_endpoint: issuer + "/oauth/token",
    registration_endpoint: issuer + "/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["listflow.read", "listflow.write"],
  };
  router.get("/.well-known/oauth-authorization-server", (_req, res) =>
    res.json(metadata),
  );
  router.get("/.well-known/oauth-protected-resource", (_req, res) =>
    res.json({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ["listflow.read", "listflow.write"],
      bearer_methods_supported: ["header"],
    }),
  );
  router.get("/.well-known/oauth-protected-resource/mcp", (_req, res) =>
    res.json({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ["listflow.read", "listflow.write"],
      bearer_methods_supported: ["header"],
    }),
  );
  router.post("/oauth/register", (req, res) => {
    try {
      const b = req.body;
      if (
        Number(
          (
            store.db
              .prepare(
                "SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'oauth-client:%'",
              )
              .get() as { n: number }
          ).n,
        ) >= 1000
      ) {
        res.status(429).json({ error: "registration_limit" });
        return;
      }
      const uris = b.redirect_uris;
      if (!Array.isArray(uris) || !uris.length || uris.length > 10)
        throw new Error("Supply redirect_uris");
      for (const uri of uris) {
        const u = new URL(uri);
        if (
          u.hash ||
          u.username ||
          u.password ||
          !(
            u.protocol === "https:" ||
            (u.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
          )
        )
          throw new Error("Redirect URIs require HTTPS or loopback");
      }
      if (
        !["none", "client_secret_post", undefined].includes(
          b.token_endpoint_auth_method,
        )
      )
        throw new Error("Unsupported token authentication");
      const id = random();
      const secret =
        b.token_endpoint_auth_method === "client_secret_post"
          ? random()
          : undefined;
      const c = {
        client_id: id,
        client_name: String(b.client_name || "Assistant").slice(0, 100),
        redirect_uris: uris,
        token_endpoint_auth_method: secret ? "client_secret_post" : "none",
        secret_hash: secret ? hash(secret) : undefined,
        created_at: Date.now(),
      };
      store.set("oauth-client:" + id, JSON.stringify(c));
      const { secret_hash, ...publicClient } = c;
      res.status(201).json({
        ...publicClient,
        ...(secret ? { client_secret: secret } : {}),
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    } catch (e) {
      res.status(400).json({
        error: "invalid_client_metadata",
        error_description: e instanceof Error ? e.message : "Invalid client",
      });
    }
  });
  router.get("/oauth/authorize", (req, res) => {
    try {
      const q = req.query;
      const raw = store.setting("oauth-client:" + String(q.client_id));
      if (!raw) throw new Error("Unregistered client");
      const c = JSON.parse(raw);
      if (
        q.response_type !== "code" ||
        !c.redirect_uris.includes(q.redirect_uri) ||
        q.code_challenge_method !== "S256" ||
        !/^[-_A-Za-z0-9]{43}$/.test(String(q.code_challenge)) ||
        String(q.state || "").length > 2048
      )
        throw new Error("Invalid authorization request");
      if (q.resource && !resources.has(String(q.resource)))
        throw new Error("Invalid resource");
      const scope = String(q.scope || "listflow.read")
        .split(" ")
        .filter(Boolean);
      if (scope.some((s) => !metadata.scopes_supported.includes(s)))
        throw new Error("Unsupported scope");
      const pending = random();
      const nonce = random();
      store.set(
        "oauth-pending:" + hash(pending),
        JSON.stringify({
          client_id: c.client_id,
          client_name: c.client_name,
          redirect_uri: q.redirect_uri,
          code_challenge: q.code_challenge,
          scope,
          state: q.state || "",
          resource: q.resource || resource,
          nonce_hash: hash(nonce),
          expires: Date.now() + 600000,
        }),
      );
      res.cookie("listflow_consent", nonce, {
        httpOnly: true,
        sameSite: "strict",
        secure:
          issuer.startsWith("https:") &&
          !options.browserOrigins?.includes(
            `${req.protocol}://${req.get("host")}`,
          ),
        path: new URL(issuer).pathname || "/",
        maxAge: 600000,
      });
      // Browsers apply form-action to the callback redirect as well as the POST.
      const policy = String(
        res.getHeader("Content-Security-Policy") || "default-src 'self'",
      )
        .split(";")
        .filter((directive) => !directive.trim().startsWith("form-action"))
        .join(";");
      res.set(
        "Content-Security-Policy",
        `${policy};form-action 'self' ${new URL(String(q.redirect_uri)).origin}`,
      );
      res
        .set("Referrer-Policy", "strict-origin")
        .type("html")
        .send(
          `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect to ListFlow</title><style>body{background:#111214;color:#ddd;font:15px system-ui;display:grid;place-items:center;min-height:95vh}main{max-width:430px;padding:32px;border:1px solid #39333f;border-radius:15px;background:#1c1a21}h1{font-size:24px}p{line-height:1.7;color:#a99db8}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:7px;margin:8px 0;background:#24202d;color:#eee;border:1px solid #50455f}button{background:#8275df;cursor:pointer}small{font-size:11px;color:#8f829d;overflow-wrap:anywhere}</style><main><h1>Connect ${escape(c.client_name)}?</h1><p>This assistant requests <strong>${scope.includes("listflow.write") ? "read and item-edit" : "read-only"}</strong> access to your private ListFlow workspace. Bulk and destructive changes still require your approval in ListFlow.</p><small>Redirect: ${escape(String(q.redirect_uri))}</small><form method="post" action="${escape(consentPath)}/oauth/approve"><input type="hidden" name="pending" value="${pending}"><label>Workspace password<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Authorize assistant</button></form><a href="${escape(issuer)}/" style="color:#afa0e2">Cancel</a></main></html>`,
        );
    } catch (e) {
      res.status(400).json({
        error: "invalid_request",
        error_description: e instanceof Error ? e.message : "Invalid request",
      });
    }
  });
  router.post("/oauth/approve", (req, res) => {
    const key = "oauth-pending:" + hash(String(req.body.pending || ""));
    const raw = store.setting(key);
    const cookie = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("listflow_consent="))
      ?.slice("listflow_consent=".length);
    if (!raw || !cookie) {
      res.status(400).send("Consent request expired");
      return;
    }
    const pending = JSON.parse(raw);
    if (
      pending.expires < Date.now() ||
      pending.nonce_hash !== hash(cookie) ||
      !verifyPassword(String(req.body.password || ""))
    ) {
      res
        .status(403)
        .send(
          "Authorization denied. Check the password or restart the connection.",
        );
      return;
    }
    store.db.prepare("DELETE FROM settings WHERE key=?").run(key);
    const code = random();
    store.set(
      "oauth-code:" + hash(code),
      JSON.stringify({ ...pending, expires: Date.now() + 120000 }),
    );
    const redirect = new URL(pending.redirect_uri);
    redirect.searchParams.set("code", code);
    if (pending.state) redirect.searchParams.set("state", pending.state);
    redirect.searchParams.set("iss", issuer);
    res.clearCookie("listflow_consent", {
      path: new URL(issuer).pathname || "/",
    });
    res.redirect(redirect.toString());
  });
  function issue(grant: any, res: express.Response) {
    const token = random(),
      refresh = random();
    const scopes = grant.scope.includes("listflow.write")
      ? "read,write"
      : "read";
    store.db
      .prepare("INSERT INTO credentials VALUES (?,?,?,?,?)")
      .run(
        hash(token),
        "oauth",
        scopes,
        Date.now() + 3600000,
        grant.client_name,
      );
    store.set(
      "oauth-refresh:" + hash(refresh),
      JSON.stringify({
        ...grant,
        access_hash: hash(token),
        expires: Date.now() + 30 * 86400000,
      }),
    );
    res.header("Cache-Control", "no-store").json({
      access_token: token,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refresh,
      scope: grant.scope.join(" "),
    });
  }
  router.post("/oauth/token", (req, res) => {
    const b = req.body;
    const raw = store.setting("oauth-client:" + String(b.client_id));
    if (!raw) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
    const client = JSON.parse(raw);
    if (
      client.secret_hash &&
      client.secret_hash !== hash(String(b.client_secret || ""))
    ) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
    if (b.resource && !resources.has(String(b.resource))) {
      res.status(400).json({ error: "invalid_target" });
      return;
    }
    const isCode = b.grant_type === "authorization_code";
    if (!isCode && b.grant_type !== "refresh_token") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }
    const key =
      (isCode ? "oauth-code:" : "oauth-refresh:") +
      hash(String(isCode ? b.code : b.refresh_token));
    const saved = store.setting(key);
    if (!saved) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    const grant = JSON.parse(saved);
    if (b.resource && b.resource !== grant.resource) {
      res.status(400).json({ error: "invalid_target" });
      return;
    }
    if (
      (!isCode &&
        !store.db
          .prepare("SELECT hash FROM credentials WHERE hash=?")
          .get(grant.access_hash)) ||
      grant.expires < Date.now() ||
      grant.client_id !== client.client_id ||
      (isCode &&
        (grant.redirect_uri !== b.redirect_uri ||
          !/^[-._~A-Za-z0-9]{43,128}$/.test(String(b.code_verifier)) ||
          createHash("sha256")
            .update(String(b.code_verifier))
            .digest("base64url") !== grant.code_challenge))
    ) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    store.db.prepare("DELETE FROM settings WHERE key=?").run(key);
    issue(grant, res);
  });
  return router;
}
