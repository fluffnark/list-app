import { afterEach, expect, it, vi } from "vitest";
import { uuid } from "../shared/model";

afterEach(() => vi.unstubAllGlobals());

it("generates unique RFC 4122 v4 IDs on LAN HTTP without randomUUID", () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal("crypto", { getRandomValues });
  const ids = Array.from({ length: 100 }, uuid);
  expect(new Set(ids).size).toBe(100);
  for (const id of ids)
    expect(id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
});
