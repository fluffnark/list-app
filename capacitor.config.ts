import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.doomslug.listflow",
  appName: "ListFlow",
  webDir: "dist",
  android: {
    allowMixedContent: process.env.LISTFLOW_ALLOW_TEST_HTTP === "1",
    // Android 15+ draws apps edge-to-edge; inset the WebView so the status
    // and navigation bars don't cover the top bar and bottom nav.
    adjustMarginsForEdgeToEdge: "auto",
  },
};

export default config;
