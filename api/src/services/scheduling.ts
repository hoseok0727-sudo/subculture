import { pool } from "../db.js";

type DbDate = Date | string | null;

type EventRow = {
  id: string;
  region_id: string;
  type: "PICKUP" | "UPDATE" | "MAINTENANCE" | "EVENT" | "CAMPAIGN";
  title: string;
  start_at_utc: DbDate;
  end_at_utc: DbDate;
  created_at: DbDate;
  visibility: "PUBLIC" | "NEED_REVIEW" | "HIDDEN";
};

type RuleRow = {
  id: string;
  user_id: string;
  scope: "GLOBAL" | "REGION";
  region_id: string | null;
  event_type: EventRow["type"];
  trigger: "ON_START" | "ON_END" | "BEFORE_END" | "BEFORE_START" | "ON_PUBLISH";
  offset_minutes: number | null;
  channel: "WEBPUSH" | "EMAIL" | "DISCORD";
  enabled: boolean;
};

function toDate(value: DbDate): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeScheduledAt(rule: RuleRow, event: EventRow): Date | null {
  const startAt = toDate(event.start_at_utc);
  const endAt = toDate(event.end_at_utc);
  const createdAt = toDate(event.created_at) ?? new Date();
  const offsetMs = (rule.offset_minutes ?? 0) * 60 * 1000;

  switch (rule.trigger) {
    case "ON_START":
      return startAt;
    case "ON_END":
      return endAt;
    case "BEFORE_END":
      return endAt ? new Date(endAt.getTime() - offsetMs) : null;
    case "BEFORE_START":
      return startAt ? new Date(startAt.getTime() - offsetMs) : null;
    case "ON_PUBLISH":
      return createdAt;
    default:
      return null;
  }
}

async function getEvent(eventId: number): Promise<EventRow | null> {
  const result = await pool.query<EventRow>(
    `SELECT id, region_id, type, title, start_at_utc, end_at_utc, created_at, visibility
     FROM events
     WHERE id = $1`,
    [eventId]
  );

  return result.rows[0] ?? null;
}

async function getEligibleRulesForEvent(event: EventRow, userId?: number): Promise<RuleRow[]> {
  const values: unknown[] = [event.type, Number(event.region_id)];
  const clauses = [
    `enabled = true`,
    `event_type = $1`,
    `(scope = 'GLOBAL' OR (scope = 'REGION' AND region_id = $2))`
  ];

  if (userId) {
    values.push(userId);
    clauses.push(`user_id = $${values.length}`);
  }

  const result = await pool.query<RuleRow>(
    `SELECT id, user_id, scope, region_id, event_type, trigger, offset_minutes, channel, enabled
     FROM notification_rules
     WHERE ${clauses.join(" AND ")}`,
    values
  );

  return result.rows;
}

async function getTargetUsersForRegion(regionId: number, userId?: number) {
  const values: unknown[] = [regionId];
  const clauses = [`region_id = $1`, `enabled = true`];

  if (userId) {
    values.push(userId);
    clauses.push(`user_id = $${values.length}`);
  }

  const result = await pool.query<{ user_id: string }>(
    `SELECT DISTINCT user_id
     FROM user_games
     WHERE ${clauses.join(" AND ")}`,
    values
  );

  return result.rows.map((row) => Number(row.user_id));
}

function makeDedupeKey(
  userId: number,
  eventId: number,
  channel: RuleRow["channel"],
  trigger: RuleRow["trigger"],
  offsetMinutes: number
) {
  return [userId, eventId, channel, trigger, offsetMinutes].join(":");
}

async function upsertSchedule(params: {
  userId: number;
  event: EventRow;
  rule: RuleRow;
  scheduledAt: Date;
}) {
  const { userId, event, rule, scheduledAt } = params;
  const offset = rule.offset_minutes ?? 0;
  const dedupeKey = makeDedupeKey(userId, Number(event.id), rule.channel, rule.trigger, offset);

  const payload = {
    eventTitle: event.title,
    eventType: event.type,
    trigger: rule.trigger,
    offsetMinutes: offset,
    channel: rule.channel
  };

  await pool.query(
    `INSERT INTO notification_schedules (
      user_id,
      event_id,
      channel,
      trigger_type,
      trigger_offset_minutes,
      scheduled_at_utc,
      status,
      payload_json,
      dedupe_key
    ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7::jsonb, $8)
    ON CONFLICT (dedupe_key)
    DO UPDATE SET
      scheduled_at_utc = EXCLUDED.scheduled_at_utc,
      payload_json = EXCLUDED.payload_json,
      status = CASE
        WHEN notification_schedules.status = 'SENT' THEN notification_schedules.status
        ELSE 'PENDING'
      END,
      updated_at = NOW()`,
    [
      userId,
      Number(event.id),
      rule.channel,
      rule.trigger,
      offset,
      scheduledAt.toISOString(),
      JSON.stringify(payload),
      dedupeKey
    ]
  );
}

async function planForEventAndUsers(event: EventRow, explicitUserId?: number) {
  if (event.visibility !== "PUBLIC") {
    return { planned: 0, skipped: 0 };
  }

  const now = Date.now();
  const targetUsers = await getTargetUsersForRegion(Number(event.region_id), explicitUserId);
  if (targetUsers.length === 0) {
    return { planned: 0, skipped: 0 };
  }

  let planned = 0;
  let skipped = 0;

  const groupedRulesByUser = new Map<number, RuleRow[]>();

  for (const userId of targetUsers) {
    const rules = await getEligibleRulesForEvent(event, userId);
    groupedRulesByUser.set(userId, rules);
  }

  for (const [userId, rules] of groupedRulesByUser.entries()) {
    for (const rule of rules) {
      const scheduledAt = computeScheduledAt(rule, event);
      if (!scheduledAt) {
        skipped += 1;
        continue;
      }

      if (scheduledAt.getTime() < now - 5 * 60 * 1000) {
        skipped += 1;
        continue;
      }

      await upsertSchedule({ userId, event, rule, scheduledAt });
      planned += 1;
    }
  }

  return { planned, skipped };
}

export async function planNotificationsForEvent(eventId: number) {
  const event = await getEvent(eventId);
  if (!event) {
    return { planned: 0, skipped: 0, reason: "event_not_found" };
  }

  await pool.query(
    `DELETE FROM notification_schedules
     WHERE event_id = $1 AND status IN ('PENDING', 'FAILED', 'CANCELED')`,
    [eventId]
  );

  const result = await planForEventAndUsers(event);
  return { ...result, reason: "ok" };
}

export async function rebuildSchedulesForUser(userId: number) {
  await pool.query(
    `DELETE FROM notification_schedules
     WHERE user_id = $1 AND status IN ('PENDING', 'FAILED', 'CANCELED')`,
    [userId]
  );

  const eventRows = await pool.query<EventRow>(
    `SELECT e.id, e.region_id, e.type, e.title, e.start_at_utc, e.end_at_utc, e.created_at, e.visibility
     FROM events e
     JOIN user_games ug ON ug.region_id = e.region_id
     WHERE ug.user_id = $1
       AND ug.enabled = true
       AND e.visibility = 'PUBLIC'
       AND (
         e.end_at_utc IS NULL
         OR e.end_at_utc >= NOW() - INTERVAL '1 day'
       )`,
    [userId]
  );

  let planned = 0;
  let skipped = 0;

  for (const event of eventRows.rows) {
    const result = await planForEventAndUsers(event, userId);
    planned += result.planned;
    skipped += result.skipped;
  }

  return { planned, skipped, events: eventRows.rowCount };
}
