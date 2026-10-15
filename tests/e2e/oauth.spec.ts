import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
test("OAuth discovery, explicit consent, PKCE, one-time codes and refresh revocation", async ({
  request,
}) => {
  const issuer = "http://localhost:4318";
  const challengeVerifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(challengeVerifier)
    .digest("base64url");
  expect(
    (await request.get("/.well-known/oauth-authorization-server")).ok(),
  ).toBeTruthy();
  const unauthorized = await request.post("/mcp", { data: {} });
  expect(unauthorized.status()).toBe(401);
  expect(unauthorized.headers()["www-authenticate"]).toContain(
    "resource_metadata",
  );
  expect(
    (
      await request.post("/oauth/register", {
        data: { redirect_uris: ["http://evil.example/callback"] },
      })
    ).status(),
  ).toBe(400);
  const registration = await request.post("/oauth/register", {
    data: {
      client_name: "Test chat client",
      redirect_uris: ["https://example.com/callback"],
      token_endpoint_auth_method: "none",
    },
  });
  expect(registration.status()).toBe(201);
  const { client_id } = await registration.json();
  const query = new URLSearchParams({
    client_id,
    response_type: "code",
    redirect_uri: "https://example.com/callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "listflow.read",
    state: "state-echo",
    resource: issuer + "/mcp",
  });
  const authorization = await request.get("/oauth/authorize?" + query);
  const html = await authorization.text();
  expect(html).toContain("read-only");
  const pending = html.match(/name="pending" value="([^"]+)"/)![1];
  const approve = await request.post("/oauth/approve", {
    form: { pending, password: "listflow-test-password" },
    maxRedirects: 0,
  });
  expect(approve.status()).toBe(302);
  const location = new URL(approve.headers().location);
  expect(location.searchParams.get("state")).toBe("state-echo");
  const code = location.searchParams.get("code")!;
  const form = {
    client_id,
    grant_type: "authorization_code",
    code,
    redirect_uri: "https://example.com/callback",
    code_verifier: challengeVerifier,
    resource: issuer + "/mcp",
  };
  expect(
    (
      await request.post("/oauth/token", {
        form: { ...form, code_verifier: "x".repeat(43) },
      })
    ).status(),
  ).toBe(400);
  const exchanged = await request.post("/oauth/token", { form });
  expect(exchanged.ok()).toBeTruthy();
  const token = await exchanged.json();
  expect((await request.post("/oauth/token", { form })).status()).toBe(400);
  const tools = await request.post("/mcp", {
    headers: { Authorization: "Bearer " + token.access_token },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect((await tools.json()).result.tools.length).toBeGreaterThan(5);
  const refreshed = await request.post("/oauth/token", {
    form: {
      client_id,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      resource: issuer + "/mcp",
    },
  });
  expect(refreshed.ok()).toBeTruthy();
  const next = await refreshed.json();
  expect(next.access_token).not.toBe(token.access_token);
  await request.post("/auth/login", {
    data: { password: "listflow-test-password" },
  });
  const tokens = await (await request.get("/api/tokens")).json();
  const latest = tokens.find(
    (t: any) =>
      t.hash === createHash("sha256").update(next.access_token).digest("hex"),
  );
  await request.delete("/api/tokens/" + latest.hash);
  expect(
    (
      await request.post("/oauth/token", {
        form: {
          client_id,
          grant_type: "refresh_token",
          refresh_token: next.refresh_token,
        },
      })
    ).status(),
  ).toBe(400);
});
