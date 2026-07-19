import { build } from "esbuild";

await build({
  entryPoints: ["src/client.js"],
  bundle: true,
  minify: true,
  outfile: "public/app.js"
});
