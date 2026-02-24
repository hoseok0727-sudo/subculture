import assert from "node:assert/strict";
import test from "node:test";
import { extractDateRange, parseRawNoticeToEventDraft } from "../services/ingest.js";

test("extractDateRange parses full datetime range", () => {
  const text = "2026/03/01 10:00 ~ 2026/03/08 11:30";
  const result = extractDateRange(text, "Asia/Seoul");

  assert.ok(result.startAtUtc);
  assert.ok(result.endAtUtc);
  assert.equal(result.startAtUtc, "2026-03-01T01:00:00.000Z");
  assert.equal(result.endAtUtc, "2026-03-08T02:30:00.000Z");
});

test("parseRawNoticeToEventDraft detects pickup events", () => {
  const result = parseRawNoticeToEventDraft({
    title: "[KR] Pickup Recruitment Notice",
    contentText: "Rate up starts at 2026/03/01 10:00 ~ 2026/03/08 11:30",
    timezone: "Asia/Seoul"
  });

  assert.equal(result.type, "PICKUP");
  assert.ok(result.confidence >= 0.65);
  assert.equal(result.visibility, "PUBLIC");
});

test("parseRawNoticeToEventDraft marks low confidence when time is missing", () => {
  const result = parseRawNoticeToEventDraft({
    title: "General Notice",
    contentText: "This is a generic announcement without schedule info.",
    timezone: "Asia/Seoul"
  });

  assert.equal(result.type, "EVENT");
  assert.ok(result.confidence < 0.65);
  assert.equal(result.visibility, "NEED_REVIEW");
});
