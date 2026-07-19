import { build } from "esbuild";

await build({
  entryPoints: { app: "src/client.js", labels: "src/labels-client.js" },
  bundle: true,
  minify: true,
  outdir: "public"
});
