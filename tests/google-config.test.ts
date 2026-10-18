import { expect, it } from "vitest";
import { Store } from "../server/store";
import { googleCredentials, saveGoogleCredentials } from "../server/sheets";
it("validates and encrypts OAuth credentials and drops tokens on client/account changes", () => {
  const store = new Store(":memory:");
  try {
    expect(() =>
      saveGoogleCredentials(store, "test", { clientId: "bad" }),
    ).toThrow();
    expect(store.setting("google_client")).toBeUndefined();
    const config = {
      clientId: "123-example.apps.googleusercontent.com",
      clientSecret: "GOCSPX-private-secret",
      ownerEmail: "Owner@Gmail.com",
    };
    saveGoogleCredentials(store, "test", config);
    expect(googleCredentials(store, "test")).toEqual({
      ...config,
      ownerEmail: "owner@gmail.com",
    });
    expect(store.setting("google_client")).not.toContain(config.clientSecret);
    store.set("google_refresh", "old-token");
    store.set("google_scopes", "calendar");
    saveGoogleCredentials(store, "test", config);
    expect(store.setting("google_refresh")).toBe("old-token");
    saveGoogleCredentials(store, "test", {
      ...config,
      ownerEmail: "other@gmail.com",
    });
    expect(store.setting("google_refresh")).toBeUndefined();
    expect(store.setting("google_scopes")).toBeUndefined();
  } finally {
    store.db.close();
  }
});
