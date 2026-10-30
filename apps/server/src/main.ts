import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { runMaintenanceWorker } from "./retention.ts";

const role = process.argv[2];
if (role === "worker") {
  await runMaintenanceWorker(process.env);
} else if (role === "server") {
  const { app } = await createApp(process.env);
  const server = serve({ fetch: app.fetch, port: 3000 }, () => console.log("flitz server listening on port 3000"));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
} else {
  throw new Error(`Unknown role "${role}", expected "server" or "worker"`);
}
