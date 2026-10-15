import { test, expect } from "@playwright/test";
import { newItem, uuid } from "../../shared/model";
test("authorization, retry safety, conflict merge and assistant approval gates", async ({
  request,
}) => {
  expect((await request.get("/api/bootstrap")).status()).toBe(401);
  expect(
    (
      await request.post("/auth/login", { data: { password: "wrong" } })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/auth/login", {
        data: { password: "listflow-test-password" },
      })
    ).ok(),
  ).toBeTruthy();
  const item = newItem("API test " + Date.now());
  const operation = {
    id: uuid(),
    entity_id: item.id,
    actor_id: "forged actor",
    device_id: "test",
    base_version: 0,
    operation_type: "create",
    patch: item,
    client_created_at: new Date().toISOString(),
  };
  const post = async (op: any) =>
    (
      await (
        await request.post("/api/operations:batch", {
          data: { operations: [op] },
        })
      ).json()
    ).results[0];
  const first = await post(operation);
  expect(first.status).toBe("applied");
  expect(await post(operation)).toEqual(first);
  expect(first.changes[0].actor_id).toBe("owner");
  const edit = (patch: any) => ({
    ...operation,
    id: uuid(),
    base_version: 1,
    operation_type: "patch",
    patch,
  });
  expect((await post(edit({ title: "First title" }))).status).toBe("applied");
  expect((await post(edit({ body_md: "Disjoint body" }))).status).toBe(
    "applied",
  );
  const conflict = await post(edit({ title: "Conflicting title" }));
  expect(conflict.status).toBe("conflict");
  expect(conflict.changes[0].title).toBe("First title");
  const readToken = (
    await (
      await request.post("/api/tokens", {
        data: { label: "Read test", write: false },
      })
    ).json()
  ).token;
  const headers = { Authorization: "Bearer " + readToken };
  const query = await request.post("/mcp", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "query_items", arguments: { query: "First title" } },
    },
  });
  expect((await query.json()).result.isError).toBeUndefined();
  const denied = await request.post("/mcp", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "create_item",
        arguments: { title: "Nope", idempotency_key: uuid() },
      },
    },
  });
  expect((await denied.json()).result.isError).toBe(true);
  expect(
    (
      await request.post("/api/operations:batch", {
        headers,
        data: { operations: [operation] },
      })
    ).status(),
  ).toBe(403);
  const writeToken = (
    await (
      await request.post("/api/tokens", {
        data: { label: "Write test", write: true },
      })
    ).json()
  ).token;
  const writeHeaders = { Authorization: "Bearer " + writeToken };
  expect(
    (
      await request.post("/api/operations:batch", {
        headers: writeHeaders,
        data: {
          operations: [
            {
              ...operation,
              id: uuid(),
              base_version: 3,
              operation_type: "delete",
              patch: {},
            },
          ],
        },
      })
    ).status(),
  ).toBe(403);
  const proposal = await request.post("/api/agent/propose_bulk_change", {
    headers: writeHeaders,
    data: {
      operations: [
        {
          ...operation,
          id: uuid(),
          base_version: 3,
          operation_type: "delete",
          patch: {},
        },
      ],
    },
  });
  const p = await proposal.json();
  expect(p.status).toBe("pending");
  expect(
    (
      await request.post("/api/proposals/" + p.proposal_id, {
        headers: writeHeaders,
        data: { approve: true },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/proposals/" + p.proposal_id, {
        data: { approve: true },
      })
    ).ok(),
  ).toBeTruthy();
  const boot = await (await request.get("/api/bootstrap")).json();
  expect(
    boot.entities.find((x: any) => x.id === item.id).deleted_at,
  ).toBeTruthy();
  expect(
    (
      await request.post("/api/tokens", {
        headers: { Origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
});
