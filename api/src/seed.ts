import bcrypt from "bcryptjs";
import { closePool, pool } from "./db.js";

type EventType = "PICKUP" | "UPDATE" | "MAINTENANCE" | "EVENT" | "CAMPAIGN";

async function seed() {
  const gameRows = await pool.query<{ id: string; slug: string }>(
    `INSERT INTO games (slug, name, icon_url)
     VALUES
       ('blue-archive', 'Blue Archive', null),
       ('nikke', 'GODDESS OF VICTORY: NIKKE', null),
       ('starrail', 'Honkai: Star Rail', null)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, slug`
  );

  const gameIdMap = new Map(gameRows.rows.map((row: { id: string; slug: string }) => [row.slug, Number(row.id)]));

  const regions = [
    { gameSlug: "blue-archive", code: "KR", timezone: "Asia/Seoul" },
    { gameSlug: "blue-archive", code: "JP", timezone: "Asia/Tokyo" },
    { gameSlug: "nikke", code: "KR", timezone: "Asia/Seoul" },
    { gameSlug: "nikke", code: "GL", timezone: "UTC" },
    { gameSlug: "starrail", code: "KR", timezone: "Asia/Seoul" },
    { gameSlug: "starrail", code: "GL", timezone: "UTC" }
  ];

  for (const region of regions) {
    const gameId = gameIdMap.get(region.gameSlug);
    if (!gameId) continue;

    await pool.query(
      `INSERT INTO regions (game_id, code, timezone)
       VALUES ($1, $2, $3)
       ON CONFLICT (game_id, code)
       DO UPDATE SET timezone = EXCLUDED.timezone`,
      [gameId, region.code, region.timezone]
    );
  }

  const regionRows = await pool.query<{ id: string; slug: string; code: string }>(
    `SELECT r.id, g.slug, r.code
     FROM regions r
     JOIN games g ON g.id = r.game_id`
  );

  const regionId = new Map(
    regionRows.rows.map((row: { id: string; slug: string; code: string }) => [`${row.slug}:${row.code}`, Number(row.id)])
  );

  const now = new Date();
  const iso = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

  const events: Array<{
    regionKey: string;
    type: EventType;
    title: string;
    summary: string;
    startAt: string | null;
    endAt: string | null;
    sourceUrl: string;
    eventKey: string;
    confidence: number;
  }> = [
    {
      regionKey: "blue-archive:KR",
      type: "PICKUP",
      title: "[KR] Rate Up Recruitment - Mika",
      summary: "Limited recruitment starts with increased drop rate.",
      startAt: iso(-12),
      endAt: iso(72),
      sourceUrl: "https://example.com/blue-archive/kr/pickup-mika",
      eventKey: "blue-archive-kr-pickup-mika",
      confidence: 0.95
    },
    {
      regionKey: "blue-archive:JP",
      type: "UPDATE",
      title: "[JP] Version 1.2.0 Patch Notes",
      summary: "New story chapter and QoL updates.",
      startAt: iso(-3),
      endAt: null,
      sourceUrl: "https://example.com/blue-archive/jp/update-120",
      eventKey: "blue-archive-jp-update-120",
      confidence: 0.9
    },
    {
      regionKey: "nikke:KR",
      type: "MAINTENANCE",
      title: "[KR] Scheduled Maintenance",
      summary: "Service maintenance for major update deployment.",
      startAt: iso(5),
      endAt: iso(9),
      sourceUrl: "https://example.com/nikke/kr/maintenance",
      eventKey: "nikke-kr-maint-202602",
      confidence: 0.94
    },
    {
      regionKey: "nikke:GL",
      type: "EVENT",
      title: "[GL] Co-op Event Campaign",
      summary: "Complete missions for bonus rewards.",
      startAt: iso(24),
      endAt: iso(168),
      sourceUrl: "https://example.com/nikke/gl/event-campaign",
      eventKey: "nikke-gl-event-campaign",
      confidence: 0.92
    },
    {
      regionKey: "starrail:KR",
      type: "PICKUP",
      title: "[KR] Warp Event - New Character",
      summary: "New limited character banner and signature light cone.",
      startAt: iso(30),
      endAt: iso(300),
      sourceUrl: "https://example.com/starrail/kr/warp-character",
      eventKey: "starrail-kr-warp-character",
      confidence: 0.93
    }
  ];

  for (const event of events) {
    const region = regionId.get(event.regionKey);
    if (!region) continue;

    await pool.query(
      `INSERT INTO events (
        region_id,
        type,
        title,
        summary,
        start_at_utc,
        end_at_utc,
        source_url,
        canonical_event_key,
        confidence,
        visibility
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PUBLIC')
      ON CONFLICT (canonical_event_key)
      DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        start_at_utc = EXCLUDED.start_at_utc,
        end_at_utc = EXCLUDED.end_at_utc,
        source_url = EXCLUDED.source_url,
        visibility = EXCLUDED.visibility,
        confidence = EXCLUDED.confidence`,
      [
        region,
        event.type,
        event.title,
        event.summary,
        event.startAt,
        event.endAt,
        event.sourceUrl,
        event.eventKey,
        event.confidence
      ]
    );
  }

  const adminHash = await bcrypt.hash("admin1234", 10);
  const userHash = await bcrypt.hash("demo1234", 10);

  const adminRow = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, timezone, role)
     VALUES ('admin@subculture.local', $1, 'Asia/Seoul', 'ADMIN')
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role
     RETURNING id`,
    [adminHash]
  );

  const demoUserRow = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, timezone, role)
     VALUES ('demo@subculture.local', $1, 'Asia/Seoul', 'USER')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [userHash]
  );

  const adminId = Number(adminRow.rows[0].id);
  const demoUserId = Number(demoUserRow.rows[0].id);

  const demoRegions = ["blue-archive:KR", "nikke:KR", "starrail:KR"];
  for (const key of demoRegions) {
    const rid = regionId.get(key);
    if (!rid) continue;

    await pool.query(
      `INSERT INTO user_games (user_id, region_id, enabled)
       VALUES ($1, $2, true)
       ON CONFLICT (user_id, region_id)
       DO UPDATE SET enabled = EXCLUDED.enabled`,
      [demoUserId, rid]
    );
  }

  const rules: Array<[string, string, string, number | null, string]> = [
    ["GLOBAL", "PICKUP", "ON_START", null, "WEBPUSH"],
    ["GLOBAL", "PICKUP", "BEFORE_END", 1440, "WEBPUSH"],
    ["GLOBAL", "PICKUP", "BEFORE_END", 180, "WEBPUSH"],
    ["GLOBAL", "UPDATE", "ON_PUBLISH", null, "EMAIL"],
    ["GLOBAL", "MAINTENANCE", "ON_START", null, "WEBPUSH"],
    ["GLOBAL", "MAINTENANCE", "ON_END", null, "WEBPUSH"]
  ];

  for (const [scope, eventType, trigger, offset, channel] of rules) {
    await pool.query(
      `INSERT INTO notification_rules (
        user_id,
        scope,
        region_id,
        event_type,
        trigger,
        offset_minutes,
        channel,
        enabled
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, true)
      ON CONFLICT DO NOTHING`,
      [demoUserId, scope, eventType, trigger, offset, channel]
    );
  }

  const sourceSeeds: Array<{
    regionKey: string;
    type: "RSS" | "HTML_LIST";
    baseUrl: string;
    listUrl: string;
    configJson: Record<string, unknown>;
  }> = [
    {
      regionKey: "blue-archive:KR",
      type: "RSS",
      baseUrl: "https://example.com",
      listUrl: "https://example.com/rss/blue-archive-kr.xml",
      configJson: { timezone: "Asia/Seoul" }
    },
    {
      regionKey: "nikke:KR",
      type: "HTML_LIST",
      baseUrl: "https://example.com",
      listUrl: "https://example.com/nikke/kr/notices",
      configJson: {
        timezone: "Asia/Seoul",
        itemSelector: "a",
        titleSelector: "",
        linkSelector: "",
        dateSelector: ""
      }
    }
  ];

  for (const source of sourceSeeds) {
    const rid = regionId.get(source.regionKey);
    if (!rid) continue;

    await pool.query(
      `INSERT INTO sources (
        region_id,
        type,
        base_url,
        list_url,
        enabled,
        fetch_interval_minutes,
        config_json
      )
      VALUES ($1, $2, $3, $4, true, 60, $5::jsonb)
      ON CONFLICT DO NOTHING`,
      [rid, source.type, source.baseUrl, source.listUrl, JSON.stringify(source.configJson)]
    );
  }

  console.log("Seed completed.");
  console.log(`Admin account: admin@subculture.local / admin1234 (id=${adminId})`);
  console.log(`Demo account: demo@subculture.local / demo1234 (id=${demoUserId})`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
