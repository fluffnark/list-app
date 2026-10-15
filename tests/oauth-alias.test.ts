import { afterEach, expect, it } from "vitest";
import express from "express";
import { get, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { oauthRouter } from "../server/oauth";
import { Store } from "../server/store";

let server: Server | undefined;
let store: Store | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  store?.db.close();
});

it("binds the configured tunnel audience and completes LAN consent without relaxing other audiences", async () => {
  store = new Store(":memory:");
  const issuer = "https://private.example/listflow";
  const alias = "https://tunnel.example/v1/mcp/exact-tunnel";
  const app = express();
  app.use(express.json());
  app.use(
    "/listflow",
    oauthRouter(store, issuer, (p) => p === "test-password", {
      resourceAliases: [alias],
      browserOrigins: ["http://harmony.local:4443"],
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/listflow`;
  const registration = await fetch(base + "/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Tunnel test",
      redirect_uris: ["https://example.com/callback"],
      token_endpoint_auth_method: "none",
    }),
  });
  const { client_id } = (await registration.json()) as any;
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id,
    response_type: "code",
    redirect_uri: "https://example.com/callback",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: alias,
    scope: "listflow.read listflow.write",
    state: "bound-state",
  });
  const untrusted = new URLSearchParams(params);
  untrusted.set("resource", "https://tunnel.example/v1/mcp/another-tunnel");
  expect((await fetch(base + "/oauth/authorize?" + untrusted)).status).toBe(
    400,
  );
  const browserRequest = (host: string) =>
    new Promise<{ status: number; cookie: string; html: string }>(
      (resolve, reject) => {
        get(
          base + "/oauth/authorize?" + params,
          { headers: { Host: host } },
          (response) => {
            let html = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              html += chunk;
            });
            response.on("end", () =>
              resolve({
                status: response.statusCode!,
                cookie: response.headers["set-cookie"]?.[0] || "",
                html,
              }),
            );
            response.on("error", reject);
          },
        ).on("error", reject);
      },
    );
  const consent = await browserRequest("harmony.local:4443");
  expect(consent.status).toBe(200);
  const cookie = consent.cookie;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).not.toContain("Secure");
  const html = consent.html;
  expect(html).toContain('action="/listflow/oauth/approve"');
  expect(html).toContain("read and item-edit");
  const otherHost = await browserRequest("unapproved.example");
  expect(otherHost.cookie).toContain("Secure");
  const pending = html.match(/name="pending" value="([^"]+)"/)![1];
  const approved = await fetch(base + "/oauth/approve", {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie.split(";")[0],
    },
    body: new URLSearchParams({ pending, password: "test-password" }),
  });
  expect(approved.status).toBe(302);
  const redirect = new URL(approved.headers.get("location")!);
  expect(redirect.searchParams.get("state")).toBe("bound-state");
  const form = new URLSearchParams({
    client_id,
    grant_type: "authorization_code",
    code: redirect.searchParams.get("code")!,
    redirect_uri: "https://example.com/callback",
    code_verifier: verifier,
    resource: alias,
  });
  const exchange = (body: URLSearchParams) =>
    fetch(base + "/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  const differentAudience = new URLSearchParams(form);
  differentAudience.set("resource", issuer + "/mcp");
  expect((await exchange(differentAudience)).status).toBe(400);
  const token = await exchange(form);
  expect(token.status).toBe(200);
  expect(((await token.json()) as any).scope).toBe(
    "listflow.read listflow.write",
  );
  expect((await exchange(form)).status).toBe(400);
});
