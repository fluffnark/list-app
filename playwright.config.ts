import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://localhost:4318",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npm run server",
    url: "http://localhost:4318/api/health",
    reuseExistingServer: false,
    env: {
      ADMIN_PASSWORD: "listflow-test-password",
      DATA_DIR: "/tmp/listflow-e2e-" + Date.now(),
      PUBLIC_ORIGIN: "http://localhost:4318",
    },
  },
});
