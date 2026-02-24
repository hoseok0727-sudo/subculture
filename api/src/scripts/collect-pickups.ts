import { load } from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";

type PickupItem = {
  game: string;
  region: string;
  title: string;
  startAtUtc: string | null;
  endAtUtc: string | null;
  sourceUrl: string;
  note?: string;
};

type HoyoListItem = {
  iInfoId: number;
  sTitle: string;
  sContent: string;
  dtStartTime: string;
};

type HoyoDetailItem = {
  iInfoId: number;
  sTitle: string;
  sContent: string;
  dtStartTime: string;
  dtEndTime: string;
};

type BlueArchiveThread = {
  threadId: string;
  title: string;
  createDate: number;
};

function stripHtml(input: string) {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(input: string) {
  const $ = load(`<div>${input}</div>`);
  return $("div").text().trim();
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toUtcIso(params: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  offset: string;
}) {
  const yyyy = String(params.year).padStart(4, "0");
  const mm = String(params.month).padStart(2, "0");
  const dd = String(params.day).padStart(2, "0");
  const hh = String(params.hour).padStart(2, "0");
  const min = String(params.minute).padStart(2, "0");
  const dt = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00${params.offset}`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function parseMmDdYyyy(input: string) {
  const match = input.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return {
    year: Number(match[3]),
    month: Number(match[1]),
    day: Number(match[2])
  };
}

function parseApiDateWithOffset(raw: string | undefined, offset: string) {
  if (!raw) return null;
  const match = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return toUtcIso({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    offset
  });
}

function parseFullRangeWithOffset(text: string, offset: string) {
  const match = text.match(
    /(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*(\d{1,2}):(\d{2})(?::\d{2})?[\s\S]{0,80}?(?:~|～|〜|-)\s*(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*(\d{1,2}):(\d{2})/
  );
  if (!match) return null;

  const startAtUtc = toUtcIso({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    offset
  });
  const endAtUtc = toUtcIso({
    year: Number(match[6]),
    month: Number(match[7]),
    day: Number(match[8]),
    hour: Number(match[9]),
    minute: Number(match[10]),
    offset
  });

  return {
    startAtUtc,
    endAtUtc
  };
}

function parseBlueArchiveEndRange(text: string, startAtUtc: string | null) {
  if (!startAtUtc) return null;
  const match = text.match(
    /~\s*(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C[\s\S]{0,20}?(\uC624\uC804|\uC624\uD6C4)\s*(\d{1,2})\s*\uC2DC\s*(\d{1,2})\s*\uBD84/
  );
  if (!match) return null;

  const start = new Date(startAtUtc);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;

  const endMonth = Number(match[1]);
  const endDay = Number(match[2]);
  const period = match[3];
  let hour = Number(match[4]);
  const minute = Number(match[5]);

  if (period === "\uC624\uD6C4" && hour < 12) hour += 12;
  if (period === "\uC624\uC804" && hour === 12) hour = 0;

  const year = endMonth < startMonth ? startYear + 1 : startYear;
  return toUtcIso({
    year,
    month: endMonth,
    day: endDay,
    hour,
    minute,
    offset: "+09:00"
  });
}

function parsePjskGlobalRange(text: string, fallbackYear: number) {
  const match = text.match(
    /Event Duration:\s*[^/]*\/\s*(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})\s*\(UTC\)/i
  );
  if (!match) return null;

  const startMonth = Number(match[1]);
  const startDay = Number(match[2]);
  const endMonth = Number(match[5]);
  const endDay = Number(match[6]);
  const endYear = endMonth < startMonth ? fallbackYear + 1 : fallbackYear;

  return {
    startAtUtc: toUtcIso({
      year: fallbackYear,
      month: startMonth,
      day: startDay,
      hour: Number(match[3]),
      minute: Number(match[4]),
      offset: "+00:00"
    }),
    endAtUtc: toUtcIso({
      year: endYear,
      month: endMonth,
      day: endDay,
      hour: Number(match[7]),
      minute: Number(match[8]),
      offset: "+00:00"
    })
  };
}

function parseFgoRange(text: string) {
  const match = text.match(
    /(\d{4})\s*\u5E74\s*(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65E5[\s\S]{0,60}?(\d{1,2}):(\d{2})[\s\S]{0,60}?[~\u301C\uFF5E]\s*(?:(\d{4})\s*\u5E74\s*)?(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65E5[\s\S]{0,60}?(\d{1,2}):(\d{2})/
  );
  if (!match) return null;

  const startYear = Number(match[1]);
  const startMonth = Number(match[2]);
  const startDay = Number(match[3]);
  const endMonth = Number(match[7]);
  const endDay = Number(match[8]);
  const endYear = match[6] ? Number(match[6]) : endMonth < startMonth ? startYear + 1 : startYear;

  return {
    startAtUtc: toUtcIso({
      year: startYear,
      month: startMonth,
      day: startDay,
      hour: Number(match[4]),
      minute: Number(match[5]),
      offset: "+09:00"
    }),
    endAtUtc: toUtcIso({
      year: endYear,
      month: endMonth,
      day: endDay,
      hour: Number(match[9]),
      minute: Number(match[10]),
      offset: "+09:00"
    })
  };
}

function normalizeCharset(rawCharset: string | null | undefined) {
  if (!rawCharset) return "utf-8";
  const normalized = rawCharset.trim().toLowerCase().replace(/["']/g, "");
  if (normalized === "ks_c_5601-1987") return "euc-kr";
  if (normalized === "x-euc-kr") return "euc-kr";
  return normalized;
}

function decodeBody(bytes: Uint8Array, rawCharset: string | null | undefined) {
  const charset = normalizeCharset(rawCharset);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function fetchBytes(url: string, accept: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SubcultureHubPickupCollector/1.2",
      Accept: accept
    }
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const headerCharset = response.headers.get("content-type")?.match(/charset=([^;]+)/i)?.[1];
  let charset = headerCharset ?? null;
  if (!charset) {
    const sniffed = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
    charset = sniffed.match(/<meta[^>]+charset=["']?([\w.-]+)/i)?.[1] ?? null;
  }

  return {
    bytes,
    charset
  };
}

async function fetchText(url: string, accept = "text/html,application/xhtml+xml,*/*") {
  const { bytes, charset } = await fetchBytes(url, accept);
  return decodeBody(bytes, charset);
}

async function fetchJson<T>(url: string): Promise<T> {
  const raw = await fetchText(url, "application/json,text/plain,*/*");
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
}

async function collectGenshin(): Promise<PickupItem[]> {
  const base = "https://sg-public-api-static.hoyoverse.com/content_v2_user/app/a1b1f9d3315447cc";
  const listUrl = `${base}/getContentList?iAppId=32&iChanId=395&iPageSize=80&iPage=1&sLangKey=en-us`;
  const list = await fetchJson<{ data?: { list?: HoyoListItem[] } }>(listUrl);
  const candidates = (list.data?.list ?? [])
    .filter((item) => /Event Wishes Notice|Chronicled Wish/i.test(item.sTitle))
    .slice(0, 3);

  const output: PickupItem[] = [];
  for (const item of candidates) {
    const detailUrl = `${base}/getContent?iAppId=32&iInfoId=${item.iInfoId}&sLangKey=en-us`;
    const detail = await fetchJson<{ data?: HoyoDetailItem }>(detailUrl);
    const content = stripHtml(detail.data?.sContent ?? item.sContent ?? "");
    const range = parseFullRangeWithOffset(content, "+08:00");

    output.push({
      game: "Genshin Impact",
      region: "Global",
      title: decodeHtmlEntities(detail.data?.sTitle ?? item.sTitle),
      startAtUtc: range?.startAtUtc ?? parseApiDateWithOffset(item.dtStartTime, "+08:00"),
      endAtUtc: range?.endAtUtc ?? null,
      sourceUrl: detailUrl
    });
  }
  return output;
}

async function collectStarRail(): Promise<PickupItem[]> {
  const base = "https://sg-public-api-static.hoyoverse.com/content_v2_user/app/113fe6d3b4514cdd";
  const listUrl = `${base}/getContentList?iAppId=34&iChanId=248&iPageSize=30&iPage=1&sLangKey=en-us`;
  const list = await fetchJson<{ data?: { list?: HoyoListItem[] } }>(listUrl);
  const latestUpdate = (list.data?.list ?? []).find((item) => /Version\s+\d+\.\d+.*Update/i.test(item.sTitle));
  if (!latestUpdate) return [];

  const detailUrl = `${base}/getContent?iAppId=34&iInfoId=${latestUpdate.iInfoId}&sLangKey=en-us`;
  const detail = await fetchJson<{ data?: HoyoDetailItem }>(detailUrl);
  const content = stripHtml(detail.data?.sContent ?? "");
  const names = Array.from(content.matchAll(/5-Star\s+([A-Za-z0-9' .-]+)\s*\(/g)).map((match) => match[1].trim());
  const uniqNames = Array.from(new Set(names)).slice(0, 2);
  const versionEnd = content.match(/until\s+(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})\s*\(UTC\+8\)/i);

  const endAtUtc =
    versionEnd === null
      ? null
      : toUtcIso({
          year: Number(versionEnd[1]),
          month: Number(versionEnd[2]),
          day: Number(versionEnd[3]),
          hour: Number(versionEnd[4]),
          minute: Number(versionEnd[5]),
          offset: "+08:00"
        });

  const title =
    uniqNames.length > 0
      ? `Version Pickup Highlights: ${uniqNames.join(", ")}`
      : `${detail.data?.sTitle ?? latestUpdate.sTitle} (pickup summary)`;

  return [
    {
      game: "Honkai: Star Rail",
      region: "Global",
      title,
      startAtUtc: parseApiDateWithOffset(detail.data?.dtStartTime ?? latestUpdate.dtStartTime, "+08:00"),
      endAtUtc,
      sourceUrl: detailUrl,
      note: "Parsed from latest official update notice."
    }
  ];
}

async function collectZZZ(): Promise<PickupItem[]> {
  const base = "https://sg-public-api-static.hoyoverse.com/content_v2_user/app/3e9196a4b9274bd7";
  const listUrl = `${base}/getContentList?iAppId=42&iChanId=296&iPageSize=80&iPage=1&sLangKey=en-us`;
  const list = await fetchJson<{ data?: { list?: HoyoListItem[] } }>(listUrl);
  const candidates = (list.data?.list ?? [])
    .filter((item) => /Limited-Time Channels|Signal Search Probability Details/i.test(item.sTitle))
    .slice(0, 3);

  const output: PickupItem[] = [];
  for (const item of candidates) {
    const detailUrl = `${base}/getContent?iAppId=42&iInfoId=${item.iInfoId}&sLangKey=en-us`;
    const detail = await fetchJson<{ data?: HoyoDetailItem }>(detailUrl);
    const content = stripHtml(detail.data?.sContent ?? item.sContent ?? "");
    const range = parseFullRangeWithOffset(content, "+08:00");

    output.push({
      game: "Zenless Zone Zero",
      region: "Global",
      title: decodeHtmlEntities(detail.data?.sTitle ?? item.sTitle),
      startAtUtc: range?.startAtUtc ?? parseApiDateWithOffset(detail.data?.dtStartTime ?? item.dtStartTime, "+08:00"),
      endAtUtc: range?.endAtUtc ?? null,
      sourceUrl: detailUrl
    });
  }
  return output;
}

async function collectBlueArchive(): Promise<PickupItem[]> {
  const listUrl =
    "https://forum.nexon.com/api/v1/board/1018/threads?alias=bluearchive&pageNo=1&blockStartKey=&blockStartNo=&paginationType=PAGING&pageSize=50&blockSize=5&hideType=WEB";
  const list = await fetchJson<{ threads?: BlueArchiveThread[] }>(listUrl);
  const candidates = (list.threads ?? []).filter((thread) => thread.title.includes("\uD53D\uC5C5")).slice(0, 3);

  const output: PickupItem[] = [];
  for (const thread of candidates) {
    const detailApiUrl = `https://forum.nexon.com/api/v1/thread/${thread.threadId}?alias=bluearchive`;
    const detail = await fetchJson<{ title: string; content: string; createDate: number }>(detailApiUrl);
    const text = stripHtml(detail.content ?? "");
    const startAtUtc = new Date((detail.createDate ?? thread.createDate) * 1000).toISOString();
    const endAtUtc = parseBlueArchiveEndRange(text, startAtUtc);

    output.push({
      game: "Blue Archive",
      region: "KR",
      title: decodeHtmlEntities(detail.title ?? thread.title),
      startAtUtc,
      endAtUtc,
      sourceUrl: `https://forum.nexon.com/bluearchive/board_view?thread=${thread.threadId}`
    });
  }
  return output;
}

async function collectProjectSekaiGlobal(): Promise<PickupItem[]> {
  const rawEntries = await fetchText("https://www.colorfulstage.com/news/all/entries.txt", "application/json,text/plain,*/*");
  const normalizedEntries = rawEntries.replace(/,\s*([}\]])/g, "$1");
  const entries = JSON.parse(normalizedEntries) as {
    news: Array<{
      targetUrl: string;
      title: string;
      updated: string;
    }>;
  };

  const candidates = (entries.news ?? [])
    .filter((entry) => /gacha|pickup|limited/i.test(entry.title))
    .sort((a, b) => {
      const ay = parseMmDdYyyy(a.updated)?.year ?? 0;
      const by = parseMmDdYyyy(b.updated)?.year ?? 0;
      return by - ay;
    })
    .slice(0, 3);

  const output: PickupItem[] = [];
  for (const entry of candidates) {
    const detailUrl = `https://www.colorfulstage.com${entry.targetUrl}`;
    const html = await fetchText(detailUrl);
    const $ = load(html);
    const title = $("h1").first().text().trim() || entry.title;
    const bodyText = $(".newsmaintxt").text().replace(/\s+/g, " ").trim();
    const fallback = parseMmDdYyyy(entry.updated);
    const year = fallback?.year ?? new Date().getUTCFullYear();
    const range = parsePjskGlobalRange(bodyText, year);

    output.push({
      game: "Project SEKAI (Colorful Stage!)",
      region: "Global",
      title: decodeHtmlEntities(title),
      startAtUtc: range?.startAtUtc ?? null,
      endAtUtc: range?.endAtUtc ?? null,
      sourceUrl: detailUrl
    });
  }
  return output;
}

async function collectFGO(): Promise<PickupItem[]> {
  const html = await fetchText("https://news.fate-go.jp/");
  const $ = load(html);
  const pickupWord = "\u30D4\u30C3\u30AF\u30A2\u30C3\u30D7";

  const candidates = $(".list_news li")
    .toArray()
    .map((li) => {
      const title = $(li).find(".title").text().trim();
      const href = $(li).find("a").attr("href") ?? "";
      return {
        title,
        href
      };
    })
    .filter((item) => item.title.includes(pickupWord) || item.href.includes("_pu"))
    .slice(0, 3);

  const output: PickupItem[] = [];
  for (const item of candidates) {
    const detailUrl = item.href.startsWith("http") ? item.href : `https://news.fate-go.jp${item.href}`;
    const detailHtml = await fetchText(detailUrl);
    const $$ = load(detailHtml);
    const fullText = $$(".main_contents").text().replace(/\s+/g, " ").trim();
    const range = parseFgoRange(fullText);

    output.push({
      game: "Fate/Grand Order",
      region: "JP",
      title: decodeHtmlEntities(item.title),
      startAtUtc: range?.startAtUtc ?? null,
      endAtUtc: range?.endAtUtc ?? null,
      sourceUrl: detailUrl
    });
  }
  return output;
}

function toMarkdown(items: PickupItem[]) {
  const lines: string[] = [];
  lines.push("# Pickup Snapshot");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("| Game | Region | Title | Start (UTC) | End (UTC) | Source |");
  lines.push("|---|---|---|---|---|---|");

  for (const item of items) {
    const safeTitle = (item.note ? `${item.title} (${item.note})` : item.title).replace(/\|/g, "\\|");
    lines.push(
      `| ${item.game} | ${item.region} | ${safeTitle} | ${item.startAtUtc ?? "-"} | ${item.endAtUtc ?? "-"} | ${item.sourceUrl} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

function toHtml(items: PickupItem[]) {
  const rows = items
    .map((item) => {
      const title = item.note ? `${item.title} (${item.note})` : item.title;
      return `<tr>
  <td>${escapeHtml(item.game)}</td>
  <td>${escapeHtml(item.region)}</td>
  <td>${escapeHtml(title)}</td>
  <td>${escapeHtml(item.startAtUtc ?? "-")}</td>
  <td>${escapeHtml(item.endAtUtc ?? "-")}</td>
  <td><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">source</a></td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pickup Snapshot</title>
  <style>
    body { font-family: "Noto Sans KR", "Segoe UI", sans-serif; margin: 24px; color: #1d2a2a; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d8d0c2; padding: 8px; vertical-align: top; text-align: left; }
    th { background: #f4efe6; }
    tr:nth-child(even) { background: #fcfaf5; }
    a { color: #0e7f6d; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Pickup Snapshot</h1>
  <p>Generated at: ${escapeHtml(new Date().toISOString())}</p>
  <table>
    <thead>
      <tr>
        <th>Game</th>
        <th>Region</th>
        <th>Title</th>
        <th>Start (UTC)</th>
        <th>End (UTC)</th>
        <th>Source</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}

async function main() {
  const all = await Promise.allSettled([
    collectGenshin(),
    collectStarRail(),
    collectZZZ(),
    collectBlueArchive(),
    collectProjectSekaiGlobal(),
    collectFGO()
  ]);

  const providerNames = [
    "Genshin Impact",
    "Honkai: Star Rail",
    "Zenless Zone Zero",
    "Blue Archive",
    "Project SEKAI (Global)",
    "Fate/Grand Order"
  ];

  const items: PickupItem[] = [];
  const failures: string[] = [];

  all.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(...result.value);
      return;
    }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    failures.push(`${providerNames[index]}: ${reason}`);
  });

  const deduped = new Map<string, PickupItem>();
  for (const item of items) {
    deduped.set(`${item.game}|${item.sourceUrl}`, item);
  }

  const sorted = Array.from(deduped.values()).sort((a, b) => {
    const av = a.startAtUtc ? Date.parse(a.startAtUtc) : 0;
    const bv = b.startAtUtc ? Date.parse(b.startAtUtc) : 0;
    return bv - av;
  });

  const outDir = path.resolve(process.cwd(), "reports");
  await fs.mkdir(outDir, { recursive: true });

  const datePart = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(outDir, `pickup_snapshot_${datePart}.json`);
  const mdPath = path.join(outDir, `pickup_snapshot_${datePart}.md`);
  const htmlPath = path.join(outDir, `pickup_snapshot_${datePart}.html`);

  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        itemCount: sorted.length,
        failures,
        items: sorted
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(mdPath, `\uFEFF${toMarkdown(sorted)}`, "utf8");
  await fs.writeFile(htmlPath, toHtml(sorted), "utf8");

  console.log(`Collected ${sorted.length} pickup records.`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${mdPath}`);
  console.log(`HTML: ${htmlPath}`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
