import crypto from "node:crypto";
import { load } from "cheerio";
import Parser from "rss-parser";
import { pool } from "../db.js";
import { planNotificationsForEvent } from "./scheduling.js";

type SourceType = "RSS" | "HTML_LIST" | "HTML_DETAIL" | "API";
type EventType = "PICKUP" | "UPDATE" | "MAINTENANCE" | "EVENT" | "CAMPAIGN";

type Visibility = "PUBLIC" | "NEED_REVIEW";

type SourceRow = {
  id: string;
  region_id: string;
  type: SourceType;
  base_url: string;
  list_url: string | null;
  enabled: boolean;
  fetch_interval_minutes: number;
  last_success_at: Date | null;
  last_error_at: Date | null;
  last_error_message: string | null;
  config_json: Record<string, unknown>;
  region_timezone: string;
  region_code: string;
  game_slug: string;
};

type RawCandidate = {
  url: string;
  title: string;
  publishedAt: string | null;
  contentText: string;
  rawPayload: Record<string, unknown>;
};

type RawNoticeRow = {
  id: string;
  source_id: string;
  url: string;
  title: string;
  published_at: string | null;
  content_text: string | null;
  raw_payload: Record<string, unknown> | null;
};

type ParsedEventDraft = {
  type: EventType;
  title: string;
  summary: string;
  startAtUtc: string | null;
  endAtUtc: string | null;
  confidence: number;
  visibility: Visibility;
};

type DateRange = {
  startAtUtc: string | null;
  endAtUtc: string | null;
  score: number;
};

type RunSourceFetchSummary = {
  sourceId: number;
  mode: "MANUAL" | "SCHEDULED";
  fetchedCount: number;
  parsedCount: number;
  errorCount: number;
  status: "SUCCESS" | "PARTIAL";
};

const rssParser = new Parser();

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function summarize(input: string, maxLength = 180) {
  const normalized = normalizeText(input);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function timezoneOffset(timezone: string) {
  const map: Record<string, string> = {
    "Asia/Seoul": "+09:00",
    "Asia/Tokyo": "+09:00",
    UTC: "+00:00"
  };

  return map[timezone] ?? "+00:00";
}

function toUtcIso(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone: string;
}) {
  const yyyy = String(parts.year).padStart(4, "0");
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  const hh = String(parts.hour).padStart(2, "0");
  const min = String(parts.minute).padStart(2, "0");
  const offset = timezoneOffset(parts.timezone);
  const value = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00${offset}`);
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

export function extractDateRange(text: string, timezone: string): DateRange {
  const source = normalizeText(text);

  const fullRangePattern =
    /(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*(\d{1,2}):(\d{2})/;
  const fullRangeMatch = source.match(fullRangePattern);

  if (fullRangeMatch) {
    const startAtUtc = toUtcIso({
      year: Number(fullRangeMatch[1]),
      month: Number(fullRangeMatch[2]),
      day: Number(fullRangeMatch[3]),
      hour: Number(fullRangeMatch[4]),
      minute: Number(fullRangeMatch[5]),
      timezone
    });

    const endAtUtc = toUtcIso({
      year: Number(fullRangeMatch[6]),
      month: Number(fullRangeMatch[7]),
      day: Number(fullRangeMatch[8]),
      hour: Number(fullRangeMatch[9]),
      minute: Number(fullRangeMatch[10]),
      timezone
    });

    return {
      startAtUtc,
      endAtUtc,
      score: startAtUtc && endAtUtc ? 0.35 : 0.15
    };
  }

  const sameDateRangePattern =
    /(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/;
  const sameDateRangeMatch = source.match(sameDateRangePattern);

  if (sameDateRangeMatch) {
    const startAtUtc = toUtcIso({
      year: Number(sameDateRangeMatch[1]),
      month: Number(sameDateRangeMatch[2]),
      day: Number(sameDateRangeMatch[3]),
      hour: Number(sameDateRangeMatch[4]),
      minute: Number(sameDateRangeMatch[5]),
      timezone
    });

    const endAtUtc = toUtcIso({
      year: Number(sameDateRangeMatch[1]),
      month: Number(sameDateRangeMatch[2]),
      day: Number(sameDateRangeMatch[3]),
      hour: Number(sameDateRangeMatch[6]),
      minute: Number(sameDateRangeMatch[7]),
      timezone
    });

    return {
      startAtUtc,
      endAtUtc,
      score: startAtUtc && endAtUtc ? 0.3 : 0.1
    };
  }

  const singlePattern = /(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*(\d{1,2}):(\d{2})/;
  const singleMatch = source.match(singlePattern);

  if (singleMatch) {
    const date = toUtcIso({
      year: Number(singleMatch[1]),
      month: Number(singleMatch[2]),
      day: Number(singleMatch[3]),
      hour: Number(singleMatch[4]),
      minute: Number(singleMatch[5]),
      timezone
    });

    return {
      startAtUtc: date,
      endAtUtc: null,
      score: date ? 0.15 : 0.05
    };
  }

  return {
    startAtUtc: null,
    endAtUtc: null,
    score: 0
  };
}

function detectEventType(text: string): { type: EventType; score: number } {
  const source = text.toLowerCase();

  const pickupKeywords = ["pickup", "pick-up", "rate up", "가챠", "픽업", "recruitment", "warp"];
  const updateKeywords = ["update", "patch", "패치", "업데이트", "version", "점검 후 업데이트"];
  const maintenanceKeywords = ["maintenance", "점검", "maintenance notice", "긴급 점검"];
  const campaignKeywords = ["campaign", "캠페인", "보너스", "2x", "double drop"];

  const hit = (keywords: string[]) => keywords.some((word) => source.includes(word));

  if (hit(pickupKeywords)) return { type: "PICKUP", score: 0.25 };
  if (hit(maintenanceKeywords)) return { type: "MAINTENANCE", score: 0.25 };
  if (hit(updateKeywords)) return { type: "UPDATE", score: 0.22 };
  if (hit(campaignKeywords)) return { type: "CAMPAIGN", score: 0.2 };
  return { type: "EVENT", score: 0.1 };
}

function toCanonicalEventKey(params: {
  regionId: number;
  type: EventType;
  title: string;
  startAtUtc: string | null;
  endAtUtc: string | null;
}) {
  const base = `${params.regionId}:${params.type}:${slugify(params.title)}:${params.startAtUtc ?? "na"}:${params.endAtUtc ?? "na"}`;
  const hash = sha256(base).slice(0, 12);
  return `${params.regionId}-${params.type.toLowerCase()}-${slugify(params.title)}-${hash}`;
}

function toVisibility(confidence: number): Visibility {
  return confidence >= 0.65 ? "PUBLIC" : "NEED_REVIEW";
}

export function parseRawNoticeToEventDraft(params: {
  title: string;
  contentText: string;
  timezone: string;
}): ParsedEventDraft {
  const merged = `${params.title}\n${params.contentText}`;
  const { type, score: typeScore } = detectEventType(merged);
  const dateRange = extractDateRange(merged, params.timezone);
  const summary = summarize(params.contentText || params.title, 220);

  const confidence = Math.min(1, 0.35 + typeScore + dateRange.score + (summary.length > 20 ? 0.1 : 0));

  return {
    type,
    title: normalizeText(params.title),
    summary,
    startAtUtc: dateRange.startAtUtc,
    endAtUtc: dateRange.endAtUtc,
    confidence,
    visibility: toVisibility(confidence)
  };
}

async function fetchWithTimeout(url: string, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "SubcultureHubBot/0.1 (+https://example.local)",
        Accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRssEntries(source: SourceRow): Promise<RawCandidate[]> {
  const listUrl = source.list_url ?? source.base_url;
  const feed = await rssParser.parseURL(listUrl);

  const items = (feed.items ?? []).slice(0, 50);
  return items
    .filter((item) => item.link || item.guid)
    .map((item) => {
      const url = item.link ?? item.guid ?? listUrl;
      const title = item.title ?? "Untitled notice";
      const contentText = normalizeText(item.contentSnippet ?? item.content ?? item.title ?? "");
      const publishedAt = item.isoDate ?? item.pubDate ?? null;

      return {
        url,
        title,
        publishedAt,
        contentText,
        rawPayload: {
          sourceType: "RSS",
          guid: item.guid ?? null,
          categories: item.categories ?? []
        }
      };
    });
}

function resolveMaybeRelativeUrl(baseUrl: string, maybeRelative: string) {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return maybeRelative;
  }
}

async function fetchHtmlEntries(source: SourceRow): Promise<RawCandidate[]> {
  const listUrl = source.list_url ?? source.base_url;
  const response = await fetchWithTimeout(listUrl);
  if (!response.ok) {
    throw new Error(`HTML list fetch failed with status ${response.status}`);
  }

  const html = await response.text();
  const $ = load(html);
  const config = source.config_json ?? {};

  const itemSelector = typeof config.itemSelector === "string" && config.itemSelector.length > 0 ? config.itemSelector : "a";
  const titleSelector = typeof config.titleSelector === "string" ? config.titleSelector : "";
  const linkSelector = typeof config.linkSelector === "string" ? config.linkSelector : "";
  const dateSelector = typeof config.dateSelector === "string" ? config.dateSelector : "";
  const detailSelector = typeof config.detailSelector === "string" ? config.detailSelector : "";

  const entries: RawCandidate[] = [];
  const items = $(itemSelector).slice(0, 30).toArray();

  for (const item of items) {
    const node = $(item);

    const title = titleSelector ? node.find(titleSelector).first().text().trim() : node.text().trim();

    const linkTarget = linkSelector
      ? node.find(linkSelector).first().attr("href")
      : node.attr("href") ?? node.find("a").first().attr("href");

    if (!title || !linkTarget) {
      continue;
    }

    const url = resolveMaybeRelativeUrl(source.base_url, linkTarget);
    const dateText = dateSelector ? node.find(dateSelector).first().text().trim() : "";

    let contentText = normalizeText(`${title} ${dateText}`);

    if (detailSelector) {
      try {
        const detailRes = await fetchWithTimeout(url, 12000);
        if (detailRes.ok) {
          const detailHtml = await detailRes.text();
          const $$ = load(detailHtml);
          const detailBody = $$(detailSelector).first().text().trim();
          if (detailBody) {
            contentText = normalizeText(`${contentText} ${detailBody}`);
          }
        }
      } catch {
        // Ignore detail failures, list content is enough for fallback parsing.
      }
    }

    entries.push({
      url,
      title,
      publishedAt: null,
      contentText,
      rawPayload: {
        sourceType: "HTML_LIST",
        extractedDateText: dateText
      }
    });
  }

  return entries;
}

async function fetchRawCandidates(source: SourceRow): Promise<RawCandidate[]> {
  if (source.type === "RSS") {
    return fetchRssEntries(source);
  }

  if (source.type === "HTML_LIST" || source.type === "HTML_DETAIL") {
    return fetchHtmlEntries(source);
  }

  if (source.type === "API") {
    throw new Error("API source type is not implemented yet");
  }

  return [];
}

async function getSourceById(sourceId: number): Promise<SourceRow | null> {
  const result = await pool.query<SourceRow>(
    `SELECT
      s.id,
      s.region_id,
      s.type,
      s.base_url,
      s.list_url,
      s.enabled,
      s.fetch_interval_minutes,
      s.last_success_at,
      s.last_error_at,
      s.last_error_message,
      s.config_json,
      r.timezone AS region_timezone,
      r.code AS region_code,
      g.slug AS game_slug
    FROM sources s
    JOIN regions r ON r.id = s.region_id
    JOIN games g ON g.id = r.game_id
    WHERE s.id = $1`,
    [sourceId]
  );

  return result.rows[0] ?? null;
}

async function upsertRawNotice(sourceId: number, candidate: RawCandidate) {
  const merged = normalizeText(`${candidate.title}\n${candidate.contentText}`);
  const contentHash = sha256(merged);

  const existing = await pool.query<{ id: string; content_hash: string | null }>(
    `SELECT id, content_hash
     FROM raw_notices
     WHERE source_id = $1 AND url = $2`,
    [sourceId, candidate.url]
  );

  if (existing.rows[0] && existing.rows[0].content_hash === contentHash) {
    await pool.query(
      `UPDATE raw_notices
       SET fetched_at = NOW(),
           title = $3,
           published_at = COALESCE($4::timestamptz, published_at)
       WHERE source_id = $1 AND url = $2`,
      [sourceId, candidate.url, candidate.title, candidate.publishedAt]
    );

    return {
      rawNoticeId: Number(existing.rows[0].id),
      changed: false
    };
  }

  const upserted = await pool.query<{ id: string }>(
    `INSERT INTO raw_notices (
      source_id,
      url,
      title,
      published_at,
      fetched_at,
      content_text,
      content_hash,
      raw_payload,
      parser_version,
      status
    ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7::jsonb, 'v1', 'NEW')
    ON CONFLICT (source_id, url)
    DO UPDATE SET
      title = EXCLUDED.title,
      published_at = EXCLUDED.published_at,
      fetched_at = NOW(),
      content_text = EXCLUDED.content_text,
      content_hash = EXCLUDED.content_hash,
      raw_payload = EXCLUDED.raw_payload,
      parser_version = EXCLUDED.parser_version,
      status = 'NEW'
    RETURNING id`,
    [
      sourceId,
      candidate.url,
      candidate.title,
      candidate.publishedAt,
      candidate.contentText,
      contentHash,
      JSON.stringify(candidate.rawPayload)
    ]
  );

  return {
    rawNoticeId: Number(upserted.rows[0].id),
    changed: true
  };
}

async function getRawNotice(rawNoticeId: number): Promise<RawNoticeRow | null> {
  const result = await pool.query<RawNoticeRow>(
    `SELECT id, source_id, url, title, published_at, content_text, raw_payload
     FROM raw_notices
     WHERE id = $1`,
    [rawNoticeId]
  );

  return result.rows[0] ?? null;
}

async function upsertEventFromRaw(source: SourceRow, rawNotice: RawNoticeRow) {
  const contentText = rawNotice.content_text ?? "";

  const draft = parseRawNoticeToEventDraft({
    title: rawNotice.title,
    contentText,
    timezone: source.region_timezone
  });

  const canonicalEventKey = toCanonicalEventKey({
    regionId: Number(source.region_id),
    type: draft.type,
    title: draft.title,
    startAtUtc: draft.startAtUtc,
    endAtUtc: draft.endAtUtc
  });

  const eventResult = await pool.query<{ id: string }>(
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
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (canonical_event_key)
    DO UPDATE SET
      type = EXCLUDED.type,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      start_at_utc = EXCLUDED.start_at_utc,
      end_at_utc = EXCLUDED.end_at_utc,
      source_url = EXCLUDED.source_url,
      confidence = EXCLUDED.confidence,
      visibility = EXCLUDED.visibility
    RETURNING id`,
    [
      Number(source.region_id),
      draft.type,
      draft.title,
      draft.summary,
      draft.startAtUtc,
      draft.endAtUtc,
      rawNotice.url,
      canonicalEventKey,
      draft.confidence,
      draft.visibility
    ]
  );

  const eventId = Number(eventResult.rows[0].id);

  await pool.query(
    `INSERT INTO event_raw_links (event_id, raw_notice_id)
     VALUES ($1, $2)
     ON CONFLICT (event_id, raw_notice_id) DO NOTHING`,
    [eventId, Number(rawNotice.id)]
  );

  await pool.query(
    `UPDATE raw_notices
     SET status = 'PARSED'
     WHERE id = $1`,
    [Number(rawNotice.id)]
  );

  await planNotificationsForEvent(eventId);

  return {
    eventId,
    visibility: draft.visibility,
    confidence: draft.confidence
  };
}

async function logIngestRun(params: {
  sourceId: number | null;
  mode: "MANUAL" | "SCHEDULED" | "REPARSE";
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  fetchedCount: number;
  parsedCount: number;
  errorCount: number;
  logMessage: string;
}) {
  await pool.query(
    `INSERT INTO ingest_runs (
      source_id,
      mode,
      status,
      fetched_count,
      parsed_count,
      error_count,
      log_message,
      started_at,
      finished_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
    [
      params.sourceId,
      params.mode,
      params.status,
      params.fetchedCount,
      params.parsedCount,
      params.errorCount,
      params.logMessage
    ]
  );
}

export async function runSourceFetch(
  sourceId: number,
  mode: "MANUAL" | "SCHEDULED" = "MANUAL"
): Promise<RunSourceFetchSummary> {
  const source = await getSourceById(sourceId);
  if (!source) {
    throw new Error("Source not found");
  }

  if (!source.enabled) {
    return {
      sourceId,
      mode,
      fetchedCount: 0,
      parsedCount: 0,
      errorCount: 0,
      status: "SUCCESS"
    };
  }

  let fetchedCount = 0;
  let parsedCount = 0;
  let errorCount = 0;

  try {
    const candidates = await fetchRawCandidates(source);

    fetchedCount = candidates.length;

    for (const candidate of candidates) {
      try {
        const upsertRaw = await upsertRawNotice(Number(source.id), candidate);

        if (!upsertRaw.changed) {
          continue;
        }

        const rawNotice = await getRawNotice(upsertRaw.rawNoticeId);
        if (!rawNotice) {
          continue;
        }

        await upsertEventFromRaw(source, rawNotice);
        parsedCount += 1;
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : "Unknown parse error";

        await pool.query(
          `UPDATE raw_notices
           SET status = 'ERROR'
           WHERE source_id = $1 AND url = $2`,
          [Number(source.id), candidate.url]
        );

        await pool.query(
          `UPDATE sources
           SET last_error_at = NOW(),
               last_error_message = $2
           WHERE id = $1`,
          [Number(source.id), message]
        );
      }
    }

    await pool.query(
      `UPDATE sources
       SET last_success_at = NOW(),
           last_error_message = NULL
       WHERE id = $1`,
      [Number(source.id)]
    );

    const status: "SUCCESS" | "PARTIAL" = errorCount > 0 ? "PARTIAL" : "SUCCESS";

    await logIngestRun({
      sourceId: Number(source.id),
      mode,
      status,
      fetchedCount,
      parsedCount,
      errorCount,
      logMessage: `Fetched ${fetchedCount}, parsed ${parsedCount}, errors ${errorCount}`
    });

    return {
      sourceId: Number(source.id),
      mode,
      fetchedCount,
      parsedCount,
      errorCount,
      status
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetch error";

    await pool.query(
      `UPDATE sources
       SET last_error_at = NOW(),
           last_error_message = $2
       WHERE id = $1`,
      [Number(source.id), message]
    );

    await logIngestRun({
      sourceId: Number(source.id),
      mode,
      status: "FAILED",
      fetchedCount,
      parsedCount,
      errorCount: Math.max(1, errorCount),
      logMessage: message
    });

    throw error;
  }
}

export async function runDueSourceFetches(limit = 10) {
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM sources
     WHERE enabled = true
       AND (
         last_success_at IS NULL
         OR last_success_at + (fetch_interval_minutes * INTERVAL '1 minute') <= NOW()
       )
     ORDER BY COALESCE(last_success_at, to_timestamp(0)) ASC
     LIMIT $1`,
    [limit]
  );

  const summaries: Array<{
    sourceId: number;
    status: "SUCCESS" | "PARTIAL" | "FAILED";
    parsedCount: number;
    errorCount: number;
  }> = [];

  for (const row of result.rows) {
    try {
      const summary = await runSourceFetch(Number(row.id), "SCHEDULED");
      summaries.push({
        sourceId: summary.sourceId,
        status: summary.status,
        parsedCount: summary.parsedCount,
        errorCount: summary.errorCount
      });
    } catch {
      summaries.push({
        sourceId: Number(row.id),
        status: "FAILED",
        parsedCount: 0,
        errorCount: 1
      });
    }
  }

  return {
    processedSources: summaries.length,
    summaries
  };
}

export async function reparseRawNotice(rawNoticeId: number) {
  const rawResult = await pool.query<RawNoticeRow>(
    `SELECT id, source_id, url, title, published_at, content_text, raw_payload
     FROM raw_notices
     WHERE id = $1`,
    [rawNoticeId]
  );

  const rawNotice = rawResult.rows[0];
  if (!rawNotice) {
    throw new Error("Raw notice not found");
  }

  const source = await getSourceById(Number(rawNotice.source_id));
  if (!source) {
    throw new Error("Source not found for raw notice");
  }

  const result = await upsertEventFromRaw(source, rawNotice);

  await logIngestRun({
    sourceId: Number(source.id),
    mode: "REPARSE",
    status: "SUCCESS",
    fetchedCount: 1,
    parsedCount: 1,
    errorCount: 0,
    logMessage: `Reparsed raw notice ${rawNoticeId}`
  });

  return result;
}

export async function listSources(params?: { dueOnly?: boolean }) {
  const where = ["1=1"];

  if (params?.dueOnly) {
    where.push(`enabled = true`);
    where.push(`(last_success_at IS NULL OR last_success_at + (fetch_interval_minutes * INTERVAL '1 minute') <= NOW())`);
  }

  const result = await pool.query(
    `SELECT
      s.id,
      s.region_id,
      s.type,
      s.base_url,
      s.list_url,
      s.enabled,
      s.fetch_interval_minutes,
      s.last_success_at,
      s.last_error_at,
      s.last_error_message,
      s.config_json,
      r.code AS region_code,
      g.name AS game_name
     FROM sources s
     JOIN regions r ON r.id = s.region_id
     JOIN games g ON g.id = r.game_id
     WHERE ${where.join(" AND ")}
     ORDER BY s.id DESC`
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    regionId: Number(row.region_id),
    regionCode: row.region_code,
    gameName: row.game_name,
    type: row.type,
    baseUrl: row.base_url,
    listUrl: row.list_url,
    enabled: row.enabled,
    fetchIntervalMinutes: Number(row.fetch_interval_minutes),
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    lastErrorMessage: row.last_error_message,
    configJson: row.config_json
  }));
}
