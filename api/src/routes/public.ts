import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { pool } from "../db.js";
import { asyncRoute, csvToEnumArray, csvToIntArray } from "./helpers.js";

export const publicRouter = Router();

type EventType = "PICKUP" | "UPDATE" | "MAINTENANCE" | "EVENT" | "CAMPAIGN";
type EventVisibility = "PUBLIC" | "NEED_REVIEW" | "HIDDEN";

const eventTypes: readonly EventType[] = ["PICKUP", "UPDATE", "MAINTENANCE", "EVENT", "CAMPAIGN"];

const eventsQuerySchema = z.object({
  regionIds: z.string().optional(),
  types: z.string().optional(),
  status: z.enum(["UPCOMING", "ONGOING", "ENDED"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sort: z.enum(["start_at", "end_at", "published_at"]).optional(),
  q: z.string().min(1).optional(),
  visibility: z.enum(["PUBLIC", "NEED_REVIEW", "HIDDEN", "ALL"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

publicRouter.get(
  "/games",
  asyncRoute(async (_req, res) => {
    const rows = await pool.query<{
      game_id: string;
      slug: string;
      name: string;
      icon_url: string | null;
      region_id: string | null;
      region_code: string | null;
      timezone: string | null;
    }>(
      `SELECT
        g.id AS game_id,
        g.slug,
        g.name,
        g.icon_url,
        r.id AS region_id,
        r.code AS region_code,
        r.timezone
      FROM games g
      LEFT JOIN regions r ON r.game_id = g.id
      ORDER BY g.name ASC, r.code ASC`
    );

    const map = new Map<number, { id: number; slug: string; name: string; iconUrl: string | null; regions: Array<{ id: number; code: string; timezone: string }> }>();

    for (const row of rows.rows) {
      const gameId = Number(row.game_id);
      if (!map.has(gameId)) {
        map.set(gameId, {
          id: gameId,
          slug: row.slug,
          name: row.name,
          iconUrl: row.icon_url,
          regions: []
        });
      }

      if (row.region_id && row.region_code && row.timezone) {
        map.get(gameId)?.regions.push({
          id: Number(row.region_id),
          code: row.region_code,
          timezone: row.timezone
        });
      }
    }

    res.json({ items: [...map.values()] });
  })
);

publicRouter.get(
  "/games/:gameId/regions",
  asyncRoute(async (req, res) => {
    const gameId = Number(req.params.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      res.status(400).json({ error: "Invalid game id" });
      return;
    }

    const result = await pool.query<{ id: string; code: string; timezone: string }>(
      `SELECT id, code, timezone
       FROM regions
       WHERE game_id = $1
       ORDER BY code ASC`,
      [gameId]
    );

    res.json({
      items: result.rows.map((row) => ({
        id: Number(row.id),
        code: row.code,
        timezone: row.timezone
      }))
    });
  })
);

publicRouter.get(
  "/pickup-snapshot/latest",
  asyncRoute(async (_req, res) => {
    const reportsDir = path.resolve(process.cwd(), "reports");
    const files = await fs.readdir(reportsDir).catch(() => []);
    const latest = files
      .filter((file) => /^pickup_snapshot_\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .sort()
      .at(-1);

    if (!latest) {
      res.status(404).json({ error: "Pickup snapshot report not found" });
      return;
    }

    const fullPath = path.join(reportsDir, latest);
    const raw = await fs.readFile(fullPath, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as {
      generatedAt: string;
      itemCount: number;
      failures: string[];
      items: Array<{
        game: string;
        region: string;
        title: string;
        startAtUtc: string | null;
        endAtUtc: string | null;
        sourceUrl: string;
        imageUrl?: string | null;
        note?: string;
      }>;
    };

    res.json({
      file: latest,
      generatedAt: parsed.generatedAt,
      itemCount: parsed.itemCount,
      failures: parsed.failures,
      items: parsed.items,
      copyrightNotice: "Images are loaded from official notice pages and remain property of each publisher."
    });
  })
);

publicRouter.get(
  "/events",
  asyncRoute(async (req, res) => {
    const parsed = eventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
      return;
    }

    const { regionIds, types, status, from, to, sort, q, limit = 30, offset = 0, visibility } = parsed.data;

    const where: string[] = [];
    const values: unknown[] = [];

    const regionList = csvToIntArray(regionIds);
    const typeList = csvToEnumArray<EventType>(types, eventTypes);

    const allowAllVisibility = req.authUser?.role === "ADMIN" && visibility === "ALL";

    if (!allowAllVisibility) {
      const targetVisibility: EventVisibility =
        req.authUser?.role === "ADMIN" && visibility && visibility !== "ALL"
          ? visibility
          : "PUBLIC";
      values.push(targetVisibility);
      where.push(`e.visibility = $${values.length}`);
    }

    if (regionList.length > 0) {
      values.push(regionList);
      where.push(`e.region_id = ANY($${values.length}::bigint[])`);
    }

    if (typeList.length > 0) {
      values.push(typeList);
      where.push(`e.type = ANY($${values.length}::text[])`);
    }

    if (status === "UPCOMING") {
      where.push("e.start_at_utc IS NOT NULL AND e.start_at_utc > NOW()");
    } else if (status === "ONGOING") {
      where.push("(e.start_at_utc IS NULL OR e.start_at_utc <= NOW())");
      where.push("(e.end_at_utc IS NULL OR e.end_at_utc >= NOW())");
    } else if (status === "ENDED") {
      where.push("e.end_at_utc IS NOT NULL AND e.end_at_utc < NOW()");
    }

    if (from) {
      values.push(from);
      where.push(`COALESCE(e.start_at_utc, e.created_at) >= $${values.length}::timestamptz`);
    }

    if (to) {
      values.push(to);
      where.push(`COALESCE(e.end_at_utc, e.start_at_utc, e.created_at) <= $${values.length}::timestamptz`);
    }

    if (q) {
      values.push(`%${q}%`);
      where.push(`(e.title ILIKE $${values.length} OR COALESCE(e.summary, '') ILIKE $${values.length})`);
    }

    const whereSql = where.length ? where.join(" AND ") : "1=1";

    const orderBy =
      sort === "end_at"
        ? "e.end_at_utc ASC NULLS LAST"
        : sort === "published_at"
          ? "e.created_at DESC"
          : "e.start_at_utc ASC NULLS LAST";

    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const result = await pool.query<{
      id: string;
      region_id: string;
      type: EventType;
      title: string;
      summary: string | null;
      start_at_utc: string | null;
      end_at_utc: string | null;
      source_url: string;
      image_url: string | null;
      confidence: string;
      visibility: EventVisibility;
      created_at: string;
      region_code: string;
      region_timezone: string;
      game_id: string;
      game_slug: string;
      game_name: string;
    }>(
      `SELECT
        e.id,
        e.region_id,
        e.type,
        e.title,
        e.summary,
        e.start_at_utc,
        e.end_at_utc,
        e.source_url,
        e.image_url,
        e.confidence,
        e.visibility,
        e.created_at,
        r.code AS region_code,
        r.timezone AS region_timezone,
        g.id AS game_id,
        g.slug AS game_slug,
        g.name AS game_name
      FROM events e
      JOIN regions r ON r.id = e.region_id
      JOIN games g ON g.id = r.game_id
      WHERE ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}`,
      values
    );

    res.json({
      items: result.rows.map((row) => ({
        id: Number(row.id),
        type: row.type,
        title: row.title,
        summary: row.summary,
        startAtUtc: row.start_at_utc,
        endAtUtc: row.end_at_utc,
        sourceUrl: row.source_url,
        imageUrl: row.image_url,
        confidence: Number(row.confidence),
        visibility: row.visibility,
        createdAt: row.created_at,
        game: {
          id: Number(row.game_id),
          slug: row.game_slug,
          name: row.game_name
        },
        region: {
          id: Number(row.region_id),
          code: row.region_code,
          timezone: row.region_timezone
        }
      }))
    });
  })
);

publicRouter.get(
  "/events/:id",
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid event id" });
      return;
    }

    const result = await pool.query<{
      id: string;
      region_id: string;
      type: EventType;
      title: string;
      summary: string | null;
      start_at_utc: string | null;
      end_at_utc: string | null;
      source_url: string;
      image_url: string | null;
      confidence: string;
      visibility: EventVisibility;
      created_at: string;
      updated_at: string;
      region_code: string;
      region_timezone: string;
      game_id: string;
      game_slug: string;
      game_name: string;
    }>(
      `SELECT
        e.id,
        e.region_id,
        e.type,
        e.title,
        e.summary,
        e.start_at_utc,
        e.end_at_utc,
        e.source_url,
        e.image_url,
        e.confidence,
        e.visibility,
        e.created_at,
        e.updated_at,
        r.code AS region_code,
        r.timezone AS region_timezone,
        g.id AS game_id,
        g.slug AS game_slug,
        g.name AS game_name
      FROM events e
      JOIN regions r ON r.id = e.region_id
      JOIN games g ON g.id = r.game_id
      WHERE e.id = $1`,
      [id]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    if (row.visibility !== "PUBLIC" && req.authUser?.role !== "ADMIN") {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    res.json({
      id: Number(row.id),
      type: row.type,
      title: row.title,
      summary: row.summary,
      startAtUtc: row.start_at_utc,
      endAtUtc: row.end_at_utc,
      sourceUrl: row.source_url,
      imageUrl: row.image_url,
      confidence: Number(row.confidence),
      visibility: row.visibility,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      game: {
        id: Number(row.game_id),
        slug: row.game_slug,
        name: row.game_name
      },
      region: {
        id: Number(row.region_id),
        code: row.region_code,
        timezone: row.region_timezone
      }
    });
  })
);
