import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware.js";
import { dispatchDueNotifications } from "../services/dispatch.js";
import { listSources, reparseRawNotice, runDueSourceFetches, runSourceFetch } from "../services/ingest.js";
import { planNotificationsForEvent } from "../services/scheduling.js";
import { asyncRoute } from "./helpers.js";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

const createGameSchema = z.object({
  slug: z.string().min(2).max(64),
  name: z.string().min(1).max(128),
  iconUrl: z.string().url().nullable().optional()
});

const createRegionSchema = z.object({
  gameId: z.number().int().positive(),
  code: z.string().min(2).max(8),
  timezone: z.string().min(1).max(64)
});

const createSourceSchema = z.object({
  regionId: z.number().int().positive(),
  type: z.enum(["RSS", "HTML_LIST", "HTML_DETAIL", "API"]),
  baseUrl: z.string().url(),
  listUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().optional().default(true),
  fetchIntervalMinutes: z.number().int().min(5).max(1440).optional().default(60),
  configJson: z.record(z.unknown()).optional().default({})
});

const patchEventSchema = z.object({
  type: z.enum(["PICKUP", "UPDATE", "MAINTENANCE", "EVENT", "CAMPAIGN"]).optional(),
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(2000).nullable().optional(),
  startAtUtc: z.string().datetime().nullable().optional(),
  endAtUtc: z.string().datetime().nullable().optional(),
  visibility: z.enum(["PUBLIC", "NEED_REVIEW", "HIDDEN"]).optional()
});

adminRouter.post(
  "/games",
  asyncRoute(async (req, res) => {
    const parsed = createGameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const game = parsed.data;

    const result = await pool.query<{ id: string }>(
      `INSERT INTO games (slug, name, icon_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug)
       DO UPDATE SET name = EXCLUDED.name, icon_url = EXCLUDED.icon_url
       RETURNING id`,
      [game.slug, game.name, game.iconUrl ?? null]
    );

    res.status(201).json({ id: Number(result.rows[0].id) });
  })
);

adminRouter.post(
  "/regions",
  asyncRoute(async (req, res) => {
    const parsed = createRegionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const region = parsed.data;

    const result = await pool.query<{ id: string }>(
      `INSERT INTO regions (game_id, code, timezone)
       VALUES ($1, $2, $3)
       ON CONFLICT (game_id, code)
       DO UPDATE SET timezone = EXCLUDED.timezone
       RETURNING id`,
      [region.gameId, region.code.toUpperCase(), region.timezone]
    );

    res.status(201).json({ id: Number(result.rows[0].id) });
  })
);

adminRouter.get(
  "/sources",
  asyncRoute(async (req, res) => {
    const dueOnly = String(req.query.due ?? "") === "1";
    const sources = await listSources({ dueOnly });
    res.json({ items: sources });
  })
);

adminRouter.post(
  "/sources",
  asyncRoute(async (req, res) => {
    const parsed = createSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const source = parsed.data;

    const result = await pool.query<{ id: string }>(
      `INSERT INTO sources (
        region_id,
        type,
        base_url,
        list_url,
        enabled,
        fetch_interval_minutes,
        config_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING id`,
      [
        source.regionId,
        source.type,
        source.baseUrl,
        source.listUrl ?? null,
        source.enabled,
        source.fetchIntervalMinutes,
        JSON.stringify(source.configJson)
      ]
    );

    res.status(201).json({ id: Number(result.rows[0].id) });
  })
);

adminRouter.post(
  "/sources/:id/run-fetch",
  asyncRoute(async (req, res) => {
    const sourceId = Number(req.params.id);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      res.status(400).json({ error: "Invalid source id" });
      return;
    }

    const summary = await runSourceFetch(sourceId, "MANUAL");
    res.json(summary);
  })
);

adminRouter.get(
  "/raw-notices",
  asyncRoute(async (req, res) => {
    const status = String(req.query.status ?? "").toUpperCase();

    const values: unknown[] = [];
    const where = ["1=1"];

    if (["NEW", "PARSED", "ERROR"].includes(status)) {
      values.push(status);
      where.push(`rn.status = $${values.length}`);
    }

    const result = await pool.query(
      `SELECT
        rn.id,
        rn.source_id,
        rn.url,
        rn.title,
        rn.published_at,
        rn.fetched_at,
        rn.status,
        rn.content_hash,
        s.type AS source_type,
        g.name AS game_name,
        r.code AS region_code
      FROM raw_notices rn
      JOIN sources s ON s.id = rn.source_id
      JOIN regions r ON r.id = s.region_id
      JOIN games g ON g.id = r.game_id
      WHERE ${where.join(" AND ")}
      ORDER BY rn.fetched_at DESC
      LIMIT 200`,
      values
    );

    res.json({
      items: result.rows.map((row) => ({
        id: Number(row.id),
        sourceId: Number(row.source_id),
        sourceType: row.source_type,
        url: row.url,
        title: row.title,
        publishedAt: row.published_at,
        fetchedAt: row.fetched_at,
        status: row.status,
        contentHash: row.content_hash,
        gameName: row.game_name,
        regionCode: row.region_code
      }))
    });
  })
);

adminRouter.patch(
  "/events/:id",
  asyncRoute(async (req, res) => {
    const eventId = Number(req.params.id);

    if (!Number.isInteger(eventId) || eventId <= 0) {
      res.status(400).json({ error: "Invalid event id" });
      return;
    }

    const parsed = patchEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;

    const existing = await pool.query(
      `SELECT id, type, title, summary, start_at_utc, end_at_utc, visibility
       FROM events
       WHERE id = $1`,
      [eventId]
    );

    if (!existing.rows[0]) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const event = existing.rows[0];

    await pool.query(
      `UPDATE events
       SET
        type = $2,
        title = $3,
        summary = $4,
        start_at_utc = $5,
        end_at_utc = $6,
        visibility = $7
       WHERE id = $1`,
      [
        eventId,
        data.type ?? event.type,
        data.title ?? event.title,
        data.summary ?? event.summary,
        data.startAtUtc ?? event.start_at_utc,
        data.endAtUtc ?? event.end_at_utc,
        data.visibility ?? event.visibility
      ]
    );

    await planNotificationsForEvent(eventId);

    res.json({ ok: true });
  })
);

adminRouter.post(
  "/raw-notices/:id/reparse",
  asyncRoute(async (req, res) => {
    const rawNoticeId = Number(req.params.id);

    if (!Number.isInteger(rawNoticeId) || rawNoticeId <= 0) {
      res.status(400).json({ error: "Invalid raw notice id" });
      return;
    }

    const result = await reparseRawNotice(rawNoticeId);
    res.json(result);
  })
);

adminRouter.post(
  "/ingest/run-due",
  asyncRoute(async (_req, res) => {
    const result = await runDueSourceFetches(10);
    res.json(result);
  })
);

adminRouter.post(
  "/notifications/dispatch-due",
  asyncRoute(async (req, res) => {
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;

    const result = await dispatchDueNotifications(limit);
    res.json(result);
  })
);

adminRouter.get(
  "/ingest-runs",
  asyncRoute(async (_req, res) => {
    const result = await pool.query(
      `SELECT
        ir.id,
        ir.source_id,
        ir.mode,
        ir.status,
        ir.fetched_count,
        ir.parsed_count,
        ir.error_count,
        ir.log_message,
        ir.started_at,
        ir.finished_at,
        s.type AS source_type,
        g.name AS game_name,
        r.code AS region_code
       FROM ingest_runs ir
       LEFT JOIN sources s ON s.id = ir.source_id
       LEFT JOIN regions r ON r.id = s.region_id
       LEFT JOIN games g ON g.id = r.game_id
       ORDER BY ir.started_at DESC
       LIMIT 200`
    );

    res.json({
      items: result.rows.map((row) => ({
        id: Number(row.id),
        sourceId: row.source_id ? Number(row.source_id) : null,
        mode: row.mode,
        status: row.status,
        fetchedCount: row.fetched_count,
        parsedCount: row.parsed_count,
        errorCount: row.error_count,
        logMessage: row.log_message,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        sourceType: row.source_type,
        gameName: row.game_name,
        regionCode: row.region_code
      }))
    });
  })
);
