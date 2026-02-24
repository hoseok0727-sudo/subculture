import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { withOptionalAuth } from "./middleware.js";
import { authRouter } from "./routes/auth.js";
import { publicRouter } from "./routes/public.js";
import { meRouter } from "./routes/me.js";
import { adminRouter } from "./routes/admin.js";
import { pool } from "./db.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigins.includes("*") ? true : config.corsOrigins
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(withOptionalAuth);

  app.get("/health", async (_req, res) => {
    const result = await pool.query("SELECT NOW() as now");
    res.json({ ok: true, now: result.rows[0]?.now });
  });

  app.use("/api/auth", authRouter);
  app.use("/api", publicRouter);
  app.use("/api/me", meRouter);
  app.use("/api/admin", adminRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    console.error(err);
    res.status(500).json({ error: message });
  });

  return app;
}
