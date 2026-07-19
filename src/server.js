import { createConfiguredApp } from "./app.js";

const port = Number(process.env.PORT ?? 8080);
createConfiguredApp().listen(port, "0.0.0.0", () => {
  console.log(`HomeBox Importer listening on port ${port}`);
});
