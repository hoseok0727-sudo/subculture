import { pool } from "../db.js";

type ScheduleRow = {
  id: string;
  user_id: string;
  event_id: string;
  channel: "WEBPUSH" | "EMAIL" | "DISCORD";
  trigger_type: string;
  trigger_offset_minutes: number;
  scheduled_at_utc: Date | string;
  payload_json: Record<string, unknown>;
};

async function markScheduleResult(
  scheduleId: number,
  result: "SUCCESS" | "FAILED",
  errorMessage?: string,
  responsePayload?: Record<string, unknown>
) {
  await pool.query(
    `INSERT INTO notification_deliveries (
      schedule_id,
      result,
      error_message,
      response_payload
    ) VALUES ($1, $2, $3, $4::jsonb)`,
    [scheduleId, result, errorMessage ?? null, JSON.stringify(responsePayload ?? {})]
  );

  await pool.query(
    `UPDATE notification_schedules
     SET status = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [scheduleId, result === "SUCCESS" ? "SENT" : "FAILED"]
  );
}

async function hasPushSubscription(userId: number) {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM push_subscriptions
     WHERE user_id = $1`,
    [userId]
  );

  return Number(result.rows[0]?.count ?? 0) > 0;
}

async function hasEmail(userId: number) {
  const result = await pool.query<{ email: string | null }>(
    `SELECT email FROM users WHERE id = $1`,
    [userId]
  );

  return Boolean(result.rows[0]?.email);
}

export async function dispatchDueNotifications(limit = 100) {
  const client = await pool.connect();
  let schedules: ScheduleRow[] = [];

  try {
    await client.query("BEGIN");
    const pickResult = await client.query<ScheduleRow>(
      `WITH picked AS (
        SELECT id
        FROM notification_schedules
        WHERE status = 'PENDING'
          AND scheduled_at_utc <= NOW()
        ORDER BY scheduled_at_utc ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE notification_schedules ns
      SET status = 'PROCESSING',
          updated_at = NOW()
      FROM picked
      WHERE ns.id = picked.id
      RETURNING ns.id, ns.user_id, ns.event_id, ns.channel, ns.trigger_type, ns.trigger_offset_minutes, ns.scheduled_at_utc, ns.payload_json`,
      [limit]
    );

    schedules = pickResult.rows;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  let sent = 0;
  let failed = 0;

  for (const schedule of schedules) {
    const scheduleId = Number(schedule.id);
    const userId = Number(schedule.user_id);

    try {
      if (schedule.channel === "WEBPUSH") {
        const available = await hasPushSubscription(userId);
        if (!available) {
          await markScheduleResult(scheduleId, "FAILED", "No push subscription for user", {
            channel: schedule.channel
          });
          failed += 1;
          continue;
        }
      }

      if (schedule.channel === "EMAIL") {
        const available = await hasEmail(userId);
        if (!available) {
          await markScheduleResult(scheduleId, "FAILED", "User email not available", {
            channel: schedule.channel
          });
          failed += 1;
          continue;
        }
      }

      if (schedule.channel === "DISCORD") {
        await markScheduleResult(scheduleId, "FAILED", "Discord webhook is not configured", {
          channel: schedule.channel
        });
        failed += 1;
        continue;
      }

      await markScheduleResult(scheduleId, "SUCCESS", undefined, {
        channel: schedule.channel,
        simulated: true,
        sentAt: new Date().toISOString()
      });
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected delivery error";
      await markScheduleResult(scheduleId, "FAILED", message, { channel: schedule.channel });
      failed += 1;
    }
  }

  return {
    picked: schedules.length,
    sent,
    failed
  };
}
