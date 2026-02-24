import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../middleware.js";
import { rebuildSchedulesForUser } from "../services/scheduling.js";
import { asyncRoute } from "./helpers.js";

export const meRouter = Router();

type RuleScope = "GLOBAL" | "REGION";
type EventType = "PICKUP" | "UPDATE" | "MAINTENANCE" | "EVENT" | "CAMPAIGN";
type RuleTrigger = "ON_START" | "ON_END" | "BEFORE_END" | "BEFORE_START" | "ON_PUBLISH";
type RuleChannel = "WEBPUSH" | "EMAIL" | "DISCORD";

meRouter.use(requireAuth);

const saveGameSchema = z.object({
  regionId: z.number().int().positive(),
  enabled: z.boolean().optional().default(true)
});

const ruleBaseSchema = z.object({
  scope: z.enum(["GLOBAL", "REGION"]),
  regionId: z.number().int().positive().nullable().optional(),
  eventType: z.enum(["PICKUP", "UPDATE", "MAINTENANCE", "EVENT", "CAMPAIGN"]),
  trigger: z.enum(["ON_START", "ON_END", "BEFORE_END", "BEFORE_START", "ON_PUBLISH"]),
  offsetMinutes: z.number().int().min(0).nullable().optional(),
  channel: z.enum(["WEBPUSH", "EMAIL", "DISCORD"]),
  enabled: z.boolean().optional().default(true)
});

const ruleSchema = ruleBaseSchema.refine((data) => (data.scope === "REGION" ? !!data.regionId : true), {
  message: "regionId is required when scope is REGION",
  path: ["regionId"]
});

const rulePatchSchema = ruleBaseSchema.partial();

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().optional()
});

meRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;

    const result = await pool.query<{ id: string; email: string | null; role: string; timezone: string }>(
      `SELECT id, email, role, timezone
       FROM users
       WHERE id = $1`,
      [userId]
    );

    const user = result.rows[0];
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id: Number(user.id),
      email: user.email,
      role: user.role,
      timezone: user.timezone
    });
  })
);

meRouter.get(
  "/games",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;

    const result = await pool.query<{
      region_id: string;
      enabled: boolean;
      game_id: string;
      game_name: string;
      game_slug: string;
      region_code: string;
      timezone: string;
    }>(
      `SELECT
        ug.region_id,
        ug.enabled,
        g.id AS game_id,
        g.name AS game_name,
        g.slug AS game_slug,
        r.code AS region_code,
        r.timezone
      FROM user_games ug
      JOIN regions r ON r.id = ug.region_id
      JOIN games g ON g.id = r.game_id
      WHERE ug.user_id = $1
      ORDER BY g.name ASC, r.code ASC`,
      [userId]
    );

    res.json({
      items: result.rows.map((row) => ({
        regionId: Number(row.region_id),
        enabled: row.enabled,
        game: {
          id: Number(row.game_id),
          name: row.game_name,
          slug: row.game_slug
        },
        region: {
          id: Number(row.region_id),
          code: row.region_code,
          timezone: row.timezone
        }
      }))
    });
  })
);

meRouter.post(
  "/games",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;
    const parsed = saveGameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { regionId, enabled } = parsed.data;

    await pool.query(
      `INSERT INTO user_games (user_id, region_id, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, region_id)
       DO UPDATE SET enabled = EXCLUDED.enabled`,
      [userId, regionId, enabled]
    );

    await rebuildSchedulesForUser(userId);

    res.status(201).json({ ok: true });
  })
);

meRouter.delete(
  "/games/:regionId",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;
    const regionId = Number(req.params.regionId);

    if (!Number.isInteger(regionId) || regionId <= 0) {
      res.status(400).json({ error: "Invalid region id" });
      return;
    }

    await pool.query(
      `DELETE FROM user_games
       WHERE user_id = $1 AND region_id = $2`,
      [userId, regionId]
    );

    await rebuildSchedulesForUser(userId);

    res.json({ ok: true });
  })
);

meRouter.get(
  "/feed",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;

    const regionRows = await pool.query<{ region_id: string }>(
      `SELECT region_id
       FROM user_games
       WHERE user_id = $1 AND enabled = true`,
      [userId]
    );

    const regionIds = regionRows.rows.map((row) => Number(row.region_id));

    if (regionIds.length === 0) {
      res.json({ items: [] });
      return;
    }

    const events = await pool.query(
      `SELECT
        e.id,
        e.type,
        e.title,
        e.summary,
        e.start_at_utc,
        e.end_at_utc,
        e.source_url,
        e.confidence,
        e.visibility,
        g.name AS game_name,
        g.slug AS game_slug,
        g.id AS game_id,
        r.id AS region_id,
        r.code AS region_code,
        r.timezone AS region_timezone
      FROM events e
      JOIN regions r ON r.id = e.region_id
      JOIN games g ON g.id = r.game_id
      WHERE e.visibility = 'PUBLIC'
        AND e.region_id = ANY($1::bigint[])
      ORDER BY e.start_at_utc ASC NULLS LAST
      LIMIT 100`,
      [regionIds]
    );

    res.json({
      items: events.rows.map((row) => ({
        id: Number(row.id),
        type: row.type,
        title: row.title,
        summary: row.summary,
        startAtUtc: row.start_at_utc,
        endAtUtc: row.end_at_utc,
        sourceUrl: row.source_url,
        confidence: Number(row.confidence),
        visibility: row.visibility,
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

meRouter.get(
  "/notification-rules",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;

    const result = await pool.query<{
      id: string;
      scope: RuleScope;
      region_id: string | null;
      event_type: EventType;
      trigger: RuleTrigger;
      offset_minutes: number | null;
      channel: RuleChannel;
      enabled: boolean;
    }>(
      `SELECT id, scope, region_id, event_type, trigger, offset_minutes, channel, enabled
       FROM notification_rules
       WHERE user_id = $1
       ORDER BY id DESC`,
      [userId]
    );

    res.json({
      items: result.rows.map((row) => ({
        id: Number(row.id),
        scope: row.scope,
        regionId: row.region_id ? Number(row.region_id) : null,
        eventType: row.event_type,
        trigger: row.trigger,
        offsetMinutes: row.offset_minutes,
        channel: row.channel,
        enabled: row.enabled
      }))
    });
  })
);

meRouter.post(
  "/notification-rules",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;
    const parsed = ruleSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const rule = parsed.data;

    const result = await pool.query<{ id: string }>(
      `INSERT INTO notification_rules (
        user_id,
        scope,
        region_id,
        event_type,
        trigger,
        offset_minutes,
        channel,
        enabled
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        userId,
        rule.scope,
        rule.scope === "REGION" ? rule.regionId ?? null : null,
        rule.eventType,
        rule.trigger,
        rule.offsetMinutes ?? null,
        rule.channel,
        rule.enabled
      ]
    );

    await rebuildSchedulesForUser(userId);

    res.status(201).json({ id: Number(result.rows[0].id) });
  })
);

meRouter.patch(
  "/notification-rules/:id",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;
    const ruleId = Number(req.params.id);

    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      res.status(400).json({ error: "Invalid rule id" });
      return;
    }

    const parsed = rulePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const existing = await pool.query<{
      id: string;
      scope: RuleScope;
      region_id: string | null;
      event_type: EventType;
      trigger: RuleTrigger;
      offset_minutes: number | null;
      channel: RuleChannel;
      enabled: boolean;
    }>(
      `SELECT id, scope, region_id, event_type, trigger, offset_minutes, channel, enabled
       FROM notification_rules
       WHERE id = $1 AND user_id = $2`,
      [ruleId, userId]
    );

    const row = existing.rows[0];
    if (!row) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    const merged = {
      scope: parsed.data.scope ?? row.scope,
      regionId: parsed.data.regionId ?? (row.region_id ? Number(row.region_id) : null),
      eventType: parsed.data.eventType ?? row.event_type,
      trigger: parsed.data.trigger ?? row.trigger,
      offsetMinutes: parsed.data.offsetMinutes ?? row.offset_minutes,
      channel: parsed.data.channel ?? row.channel,
      enabled: parsed.data.enabled ?? row.enabled
    };

    if (merged.scope === "REGION" && !merged.regionId) {
      res.status(400).json({ error: "regionId is required when scope is REGION" });
      return;
    }

    await pool.query(
      `UPDATE notification_rules
       SET
         scope = $3,
         region_id = $4,
         event_type = $5,
         trigger = $6,
         offset_minutes = $7,
         channel = $8,
         enabled = $9
       WHERE id = $1 AND user_id = $2`,
      [
        ruleId,
        userId,
        merged.scope,
        merged.scope === "REGION" ? merged.regionId : null,
        merged.eventType,
        merged.trigger,
        merged.offsetMinutes,
        merged.channel,
        merged.enabled
      ]
    );

    await rebuildSchedulesForUser(userId);

    res.json({ ok: true });
  })
);

meRouter.delete(
  "/notification-rules/:id",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;
    const ruleId = Number(req.params.id);

    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      res.status(400).json({ error: "Invalid rule id" });
      return;
    }

    await pool.query(
      `DELETE FROM notification_rules
       WHERE id = $1 AND user_id = $2`,
      [ruleId, userId]
    );

    await rebuildSchedulesForUser(userId);

    res.json({ ok: true });
  })
);

meRouter.post(
  "/push-subscriptions",
  asyncRoute(async (req, res) => {
    const parsed = pushSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const userId = req.authUser!.sub;
    const payload = parsed.data;

    const result = await pool.query<{ id: string }>(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent
       RETURNING id`,
      [userId, payload.endpoint, payload.p256dh, payload.auth, payload.userAgent ?? null]
    );

    res.status(201).json({ id: Number(result.rows[0].id) });
  })
);

meRouter.delete(
  "/push-subscriptions/:id",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;
    const subscriptionId = Number(req.params.id);

    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      res.status(400).json({ error: "Invalid subscription id" });
      return;
    }

    await pool.query(
      `DELETE FROM push_subscriptions
       WHERE id = $1 AND user_id = $2`,
      [subscriptionId, userId]
    );

    res.json({ ok: true });
  })
);

meRouter.get(
  "/notification-schedules",
  asyncRoute(async (req, res) => {
    const userId = req.authUser!.sub;

    const result = await pool.query<{
      id: string;
      event_id: string;
      channel: RuleChannel;
      trigger_type: RuleTrigger;
      trigger_offset_minutes: number;
      scheduled_at_utc: string;
      status: string;
      title: string;
      type: EventType;
      region_code: string;
      game_name: string;
    }>(
      `SELECT
        ns.id,
        ns.event_id,
        ns.channel,
        ns.trigger_type,
        ns.trigger_offset_minutes,
        ns.scheduled_at_utc,
        ns.status,
        e.title,
        e.type,
        r.code AS region_code,
        g.name AS game_name
      FROM notification_schedules ns
      JOIN events e ON e.id = ns.event_id
      JOIN regions r ON r.id = e.region_id
      JOIN games g ON g.id = r.game_id
      WHERE ns.user_id = $1
      ORDER BY ns.scheduled_at_utc ASC
      LIMIT 200`,
      [userId]
    );

    res.json({
      items: result.rows.map((row) => ({
        id: Number(row.id),
        eventId: Number(row.event_id),
        channel: row.channel,
        triggerType: row.trigger_type,
        triggerOffsetMinutes: row.trigger_offset_minutes,
        scheduledAtUtc: row.scheduled_at_utc,
        status: row.status,
        eventTitle: row.title,
        eventType: row.type,
        regionCode: row.region_code,
        gameName: row.game_name
      }))
    });
  })
);
