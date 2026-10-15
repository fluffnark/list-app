import { build } from "esbuild";
await build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: "server-dist/index.js",
  banner: {
    js: "import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);",
  },
  sourcemap: true,
});
