import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { operationSchema, uuid } from "../shared/model";
import { Store } from "./store";
import { SheetsProjection, seal } from "./sheets";
import { oauthRouter } from "./oauth";
import { agentTools, callAgent } from "./agents";
import { attachmentRoutes } from "./attachments";
const data = resolve(process.env.DATA_DIR || "data");
mkdirSync(data, { recursive: true, mode: 0o700 });
const secretPath = resolve(data, "secret");
if (!existsSync(secretPath))
  writeFileSync(secretPath, randomBytes(48).toString("base64url"), {
    mode: 0o600,
  });
const secret = readFileSync(secretPath, "utf8").trim();
const store = new Store(resolve(data, "listflow.sqlite"));
const passwordPath = resolve(data, "admin-password");
if (!existsSync(passwordPath))
  writeFileSync(passwordPath, randomBytes(18).toString("base64url"), {
    mode: 0o600,
  });
const password =
  process.env.ADMIN_PASSWORD || readFileSync(passwordPath, "utf8").trim();
const salt = createHash("sha256").update(secret).digest();
const passwordHash = scryptSync(password, salt, 64);
const projection = new SheetsProjection(store, secret);
const base = (process.env.APP_BASE || "").replace(/\/$/, "");
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:4318";
const lanOrigins = (process.env.LAN_HTTP_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const app = express();
app.set("trust proxy", "loopback");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.json({ limit: "2mb" }));
const router = express.Router();
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
const cookie = (req: express.Request, name: string) => {
  const part = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="));
  return part?.slice(name.length + 1);
};
function session(req: express.Request, res: express.Response) {
  const token = randomBytes(32).toString("base64url");
  store.db
    .prepare("INSERT INTO credentials VALUES (?,?,?,?,?)")
    .run(
      hash(token),
      "session",
      "read,write,admin",
      Date.now() + 30 * 86400000,
      "owner",
    );
  res.cookie("listflow_session", token, {
    httpOnly: true,
    secure:
      origin.startsWith("https:") &&
      !lanOrigins.includes(`${req.protocol}://${req.get("host")}`),
    sameSite: "strict",
    path: base || "/",
    maxAge: 30 * 86400000,
  });
}
router.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  const allowed = [
    origin,
    ...lanOrigins,
    ...(
      process.env.NATIVE_ORIGINS || "https://localhost,http://localhost"
    ).split(","),
  ];
  if (requestOrigin && !allowed.includes(requestOrigin)) {
    res.status(403).json({ error: "Origin denied" });
    return;
  }
  if (requestOrigin && allowed.includes(requestOrigin)) {
    res.header("Access-Control-Allow-Origin", requestOrigin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
router.use(
  oauthRouter(
    store,
    origin + base,
    (value) =>
      value.length <= 256 &&
      timingSafeEqual(scryptSync(value, salt, 64), passwordHash),
    {
      resourceAliases: (process.env.OAUTH_RESOURCE_ALIASES || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      browserOrigins: lanOrigins,
    },
  ),
);
router.use(
  "/auth",
  rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
router.get("/api/health", (_req, res) =>
  res.json({ ok: true, version: "0.3.0", time: new Date().toISOString() }),
);
router.get("/api/config", (_req, res) =>
  res.json({
    google: !!(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ),
    base,
    retention:
      "Trash retained until explicit permanent deletion; audit retained indefinitely",
    auth: "single-owner",
  }),
);
router.post("/auth/login", (req, res) => {
  if (typeof req.body.password !== "string" || req.body.password.length > 256) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  if (!timingSafeEqual(scryptSync(req.body.password, salt, 64), passwordHash)) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  session(req, res);
  res.json({ ok: true });
});
router.get("/auth/google", (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(503).send("Google OAuth is not configured");
    return;
  }
  const state = randomBytes(32).toString("base64url");
  store.set(
    "oauth:" + hash(state),
    JSON.stringify({
      expires: Date.now() + 600000,
      connect: !!cookie(req, "listflow_session"),
    }),
  );
  res.cookie("listflow_oauth", state, {
    httpOnly: true,
    secure: origin.startsWith("https:"),
    sameSite: "lax",
    path: base || "/",
    maxAge: 600000,
  });
  const query = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: origin + base + "/auth/google/callback",
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/drive.file",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  res.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + query);
});
router.get("/auth/google/callback", async (req, res) => {
  try {
    const state = String(req.query.state || "");
    const saved = store.setting("oauth:" + hash(state));
    if (
      !state ||
      cookie(req, "listflow_oauth") !== state ||
      !saved ||
      JSON.parse(saved).expires < Date.now()
    )
      throw new Error("Invalid or expired OAuth state");
    store.db
      .prepare("DELETE FROM settings WHERE key=?")
      .run("oauth:" + hash(state));
    res.clearCookie("listflow_oauth", { path: base || "/" });
    if (!process.env.OWNER_EMAIL)
      throw new Error("Owner email must be configured");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code: String(req.query.code),
        grant_type: "authorization_code",
        redirect_uri: origin + base + "/auth/google/callback",
      }),
    });
    const tokens = (await tokenResponse.json()) as any;
    if (!tokenResponse.ok) throw new Error("Google token exchange failed");
    const identityResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    const identity = (await identityResponse.json()) as any;
    if (
      !identityResponse.ok ||
      !identity.email_verified ||
      identity.email.toLowerCase() !== process.env.OWNER_EMAIL.toLowerCase()
    )
      throw new Error("This Google account is not the workspace owner");
    if (tokens.refresh_token)
      store.set("google_refresh", seal(tokens.refresh_token, secret));
    session(req, res);
    res.redirect(base + "/");
  } catch (e) {
    res
      .status(400)
      .send(
        "Google connection failed. Check owner email, OAuth client, and callback configuration.",
      );
  }
});
router.use(["/api", "/mcp", "/openapi.json"], (req, res, next) => {
  if (req.path === "/health") {
    next();
    return;
  }
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const token = bearer || cookie(req, "listflow_session");
  const credential = token
    ? (store.db
        .prepare(
          "SELECT kind,scopes,label FROM credentials WHERE hash=? AND expires>?",
        )
        .get(hash(token), Date.now()) as
        { kind: string; scopes: string; label: string } | undefined)
    : undefined;
  if (!credential) {
    res.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${origin}${base}/.well-known/oauth-protected-resource"`,
    );
    res.status(401).json({
      error: "Sign in to sync. Your local items remain saved on this device.",
    });
    return;
  }
  (req as any).identity = {
    ...credential,
    actor:
      credential.kind === "session" || credential.kind === "device"
        ? "owner"
        : "agent:" + credential.label,
    tokenHash: hash(token!),
  };
  next();
});
const admin = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  if (!(req as any).identity.scopes.split(",").includes("admin")) {
    res.status(403).json({ error: "Owner approval required" });
    return;
  }
  next();
};
const writer = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  if (!(req as any).identity.scopes.split(",").includes("write")) {
    res.status(403).json({ error: "Write permission required" });
    return;
  }
  next();
};
router.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
attachmentRoutes(router, store, writer);
router.get("/api/session", (req, res) =>
  res.json({
    signedIn: true,
    actor: (req as any).identity.actor,
    googleConnected: !!store.setting("google_refresh"),
    spreadsheetId: store.setting("spreadsheet_id") || null,
    sheetsError: store.setting("sheets_error") || null,
    sheetsSequence: store.setting("sheets_sequence"),
  }),
);
router.post("/api/logout", admin, (req, res) => {
  store.db
    .prepare("DELETE FROM credentials WHERE hash=?")
    .run((req as any).identity.tokenHash);
  res.clearCookie("listflow_session", { path: base || "/" });
  res.json({ ok: true });
});
router.get("/api/bootstrap", (_req, res) =>
  res.json({ entities: store.entities(), cursor: store.cursor() }),
);
router.get("/api/changes", (req, res) => {
  const cursor = Math.max(0, Number(req.query.cursor) || 0);
  if (cursor > store.cursor()) {
    res.status(409).json({
      error:
        "Server recovery detected. Export your pending edits, then refresh the server snapshot in Settings.",
    });
    return;
  }
  const changes = store.changes(cursor);
  res.json({
    changes,
    cursor: changes.at(-1)?.sequence ?? cursor,
    hasMore: changes.length === 500,
  });
});
router.post("/api/operations:batch", writer, (req, res) => {
  const ops: unknown[] = Array.isArray(req.body.operations)
    ? req.body.operations
    : [];
  if (ops.length > 100) {
    res.status(400).json({ error: "Maximum 100 operations" });
    return;
  }
  const parsed = ops.map((x) => operationSchema.safeParse(x));
  if (parsed.some((x) => !x.success)) {
    res.status(400).json({ error: "Invalid operation schema" });
    return;
  }
  if (
    !["session", "device"].includes((req as any).identity.kind) &&
    ops.some(
      (x: any) =>
        !["create", "patch", "complete", "reopen", "skip"].includes(
          x.operation_type,
        ) ||
        x.complete_all ||
        (x.operation_type === "create" && x.patch.kind !== "item") ||
        (x.operation_type === "patch" &&
          Object.keys(x.patch).some(
            (f) =>
              ![
                "title",
                "body_md",
                "priority",
                "due_at",
                "scheduled_for",
                "sort_key",
                "recurrence",
              ].includes(f),
          )),
    )
  ) {
    res
      .status(403)
      .json({ error: "Destructive agent edits require reviewed proposals" });
    return;
  }
  res.json({
    results: ops.map((x) =>
      store.apply(operationSchema.parse(x), (req as any).identity.actor),
    ),
    cursor: store.cursor(),
  });
});
router.get("/api/search", (req, res) =>
  res.json(
    callAgent(
      store,
      "query_items",
      req.query,
      (req as any).identity.actor,
      false,
    ),
  ),
);
router.get("/api/audit", admin, (req, res) =>
  res.json(store.changes(Math.max(0, Number(req.query.cursor) || 0))),
);
router.get("/api/export", admin, (_req, res) =>
  res.attachment("listflow-export.json").json({
    schema: 2,
    exported_at: new Date().toISOString(),
    entities: store.entities(),
    attachments: store.db
      .prepare("SELECT value FROM attachments")
      .all()
      .map((row: any) => JSON.parse(row.value)),
  }),
);
router.post("/api/tokens", admin, (req, res) => {
  const token = randomBytes(32).toString("base64url");
  const scopes = req.body.device
    ? "read,write,admin"
    : req.body.write
      ? "read,write"
      : "read";
  store.db
    .prepare("INSERT INTO credentials VALUES (?,?,?,?,?)")
    .run(
      hash(token),
      req.body.device ? "device" : "agent",
      scopes,
      Date.now() + 90 * 86400000,
      String(req.body.label || "assistant").slice(0, 80),
    );
  res.json({ token, scopes, expires_in_days: 90 });
});
router.get("/api/tokens", admin, (_req, res) =>
  res.json(
    store.db
      .prepare(
        "SELECT hash,scopes,expires,label FROM credentials WHERE kind IN ('agent','device','oauth')",
      )
      .all(),
  ),
);
router.delete("/api/tokens/:hash", admin, (req, res) => {
  store.db
    .prepare(
      "DELETE FROM credentials WHERE hash=? AND kind IN ('agent','device','oauth')",
    )
    .run(String(req.params.hash));
  res.json({ ok: true });
});
router.post("/api/sheets/create", admin, async (_req, res) => {
  try {
    if (!store.setting("spreadsheet_id")) await projection.create();
    await projection.sync();
    res.json({
      spreadsheetId: store.setting("spreadsheet_id"),
      error: store.setting("sheets_error"),
    });
  } catch {
    res.status(502).json({
      error: "Could not create Sheets projection; check Google authorization",
    });
  }
});
router.post("/api/sheets/rebuild", admin, async (_req, res) => {
  projection.nextTry = 0;
  await projection.sync(true);
  res.json({ error: store.setting("sheets_error") });
});
router.get("/api/proposals", admin, (_req, res) =>
  res.json(
    (
      store.db
        .prepare("SELECT value FROM proposals WHERE expires>?")
        .all(Date.now()) as { value: string }[]
    ).map((x) => JSON.parse(x.value)),
  ),
);
router.post("/api/proposals/:id", admin, (req, res) => {
  const row = store.db
    .prepare("SELECT value FROM proposals WHERE id=? AND expires>?")
    .get(String(req.params.id), Date.now()) as { value: string } | undefined;
  if (!row) {
    res.sendStatus(404);
    return;
  }
  const p = JSON.parse(row.value);
  if (p.status !== "pending") {
    res.json(p);
    return;
  }
  p.status = req.body.approve ? "approved" : "rejected";
  if (req.body.approve) {
    if (!p.operations.every((x: any) => operationSchema.safeParse(x).success)) {
      res.status(400).json({ error: "Proposal contains invalid operations" });
      return;
    }
    p.results = p.operations.map((x: any) =>
      store.apply(x, p.actor + ";approved:owner"),
    );
  }
  store.db
    .prepare("UPDATE proposals SET value=? WHERE id=?")
    .run(JSON.stringify(p), String(req.params.id));
  res.json(p);
});
router.post("/api/agent/:tool", (req, res) => {
  try {
    res.json(
      callAgent(
        store,
        String(req.params.tool),
        req.body,
        (req as any).identity.actor,
        (req as any).identity.scopes.includes("write"),
      ),
    );
  } catch (e) {
    res
      .status(400)
      .json({ error: e instanceof Error ? e.message : "Tool failed" });
  }
});
router.post("/mcp", (req, res) => {
  const msg = req.body;
  const identity = (req as any).identity;
  if (msg.id === undefined) {
    res.status(202).end();
    return;
  }
  try {
    let result: unknown;
    if (msg.method === "initialize")
      result = {
        protocolVersion: [
          "2025-03-26",
          "2025-06-18",
          "2025-11-25",
          "2026-07-28",
        ].includes(msg.params?.protocolVersion)
          ? msg.params.protocolVersion
          : "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "listflow", version: "0.3.0" },
      };
    else if (msg.method === "tools/list") result = { tools: agentTools };
    else if (msg.method === "ping") result = {};
    else if (msg.method === "tools/call") {
      const output = callAgent(
        store,
        msg.params.name,
        msg.params.arguments ?? {},
        identity.actor,
        identity.scopes.includes("write"),
      );
      result =
        msg.params.name === "get_attachment"
          ? {
              content: [
                {
                  type: "image",
                  mimeType: output.mime,
                  data: output.data_url.split(",")[1],
                },
              ],
            }
          : { content: [{ type: "text", text: JSON.stringify(output) }] };
    } else {
      res.json({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "Method not found" },
      });
      return;
    }
    res.json({ jsonrpc: "2.0", id: msg.id, result });
  } catch (e) {
    res.json({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: e instanceof Error ? e.message : "Tool failed",
          },
        ],
      },
    });
  }
});
router.get("/mcp", (_req, res) => res.set("Allow", "POST").sendStatus(405));
router.get("/openapi.json", (_req, res) =>
  res.json({
    openapi: "3.1.0",
    info: { title: "ListFlow assistant API", version: "0.3.0" },
    servers: [{ url: origin + base }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    },
    paths: Object.fromEntries(
      agentTools.map((t) => [
        "/api/agent/" + t.name,
        {
          post: {
            operationId: t.name,
            description: t.description,
            requestBody: {
              required: true,
              content: { "application/json": { schema: t.inputSchema } },
            },
            responses: {
              200: { description: "Tool result" },
              400: { description: "Validation error" },
              401: { description: "Unauthorized" },
              403: { description: "Permission denied" },
            },
          },
        },
      ]),
    ),
  }),
);
router.use(express.static(resolve("dist"), { index: false, maxAge: "1h" }));
router.get(/.*/, (_req, res) => res.sendFile(resolve("dist/index.html")));
if (base) {
  app.get("/.well-known/oauth-authorization-server" + base, (_req, res) =>
    res.redirect(307, base + "/.well-known/oauth-authorization-server"),
  );
  app.get(
    "/.well-known/oauth-protected-resource" + base + "/mcp",
    (_req, res) =>
      res.redirect(307, base + "/.well-known/oauth-protected-resource"),
  );
}
app.use(base || "/", router);
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("Request failed:", err?.name || "Error");
    res
      .status(500)
      .json({ error: "Request failed; your local changes are safe" });
  },
);
const server = app.listen(
  Number(process.env.PORT || 4318),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `ListFlow listening on ${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 4318}${base}`,
    ),
);
const timer = setInterval(() => void projection.sync(), 30000);
process.on("SIGTERM", () => {
  clearInterval(timer);
  server.close(() => {
    store.db.close();
    process.exit(0);
  });
});
