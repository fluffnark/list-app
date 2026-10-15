import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.doomslug.listflow",
  appName: "ListFlow",
  webDir: "dist",
  android: { allowMixedContent: process.env.LISTFLOW_ALLOW_TEST_HTTP === "1" },
};

export default config;
