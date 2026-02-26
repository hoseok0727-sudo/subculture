export type UserRole = "USER" | "ADMIN";

export type User = {
  id: number;
  email: string;
  role: UserRole;
  timezone: string;
};

export type Region = {
  id: number;
  code: string;
  timezone: string;
};

export type Game = {
  id: number;
  slug: string;
  name: string;
  iconUrl?: string | null;
  regions: Region[];
};

export type EventItem = {
  id: number;
  type: "PICKUP" | "UPDATE" | "MAINTENANCE" | "EVENT" | "CAMPAIGN";
  title: string;
  summary?: string | null;
  startAtUtc?: string | null;
  endAtUtc?: string | null;
  sourceUrl: string;
  imageUrl?: string | null;
  confidence: number;
  visibility?: "PUBLIC" | "NEED_REVIEW" | "HIDDEN";
  game: { id: number; slug: string; name: string };
  region: { id: number; code: string; timezone?: string };
};

export type NotificationRule = {
  id: number;
  scope: "GLOBAL" | "REGION";
  regionId: number | null;
  eventType: EventItem["type"];
  trigger: "ON_START" | "ON_END" | "BEFORE_END" | "BEFORE_START" | "ON_PUBLISH";
  offsetMinutes: number | null;
  channel: "WEBPUSH" | "EMAIL" | "DISCORD";
  enabled: boolean;
};

export type UserGame = {
  regionId: number;
  enabled: boolean;
  game: {
    id: number;
    name: string;
    slug: string;
  };
  region: Region;
};

export type NotificationSchedule = {
  id: number;
  eventId: number;
  channel: "WEBPUSH" | "EMAIL" | "DISCORD";
  triggerType: "ON_START" | "ON_END" | "BEFORE_END" | "BEFORE_START" | "ON_PUBLISH";
  triggerOffsetMinutes: number;
  scheduledAtUtc: string;
  status: "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "CANCELED";
  eventTitle: string;
  eventType: EventItem["type"];
  regionCode: string;
  gameName: string;
};

export type SourceItem = {
  id: number;
  regionId: number;
  regionCode: string;
  gameName: string;
  type: "RSS" | "HTML_LIST" | "HTML_DETAIL" | "API";
  baseUrl: string;
  listUrl: string | null;
  enabled: boolean;
  fetchIntervalMinutes: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  configJson: Record<string, unknown>;
};

export type IngestRun = {
  id: number;
  sourceId: number | null;
  mode: "MANUAL" | "SCHEDULED" | "REPARSE";
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  fetchedCount: number;
  parsedCount: number;
  errorCount: number;
  logMessage: string;
  startedAt: string;
  finishedAt: string;
  sourceType: string | null;
  gameName: string | null;
  regionCode: string | null;
};

export type PickupSnapshotItem = {
  game: string;
  region: string;
  title: string;
  startAtUtc: string | null;
  endAtUtc: string | null;
  sourceUrl: string;
  imageUrl?: string | null;
  note?: string;
};

export type PickupSnapshot = {
  file: string;
  generatedAt: string;
  itemCount: number;
  failures: string[];
  copyrightNotice?: string;
  items: PickupSnapshotItem[];
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function buildQuery(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && value.length > 0) query.set(key, value);
  }
  return query.toString();
}

async function fetchJson<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  if (init?.token) {
    headers.set("authorization", `Bearer ${init.token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `Request failed: ${res.status}`);
  }

  return body as T;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export async function signup(input: { email: string; password: string; timezone?: string }) {
  return fetchJson<{ token: string; user: User }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function login(input: { email: string; password: string }) {
  return fetchJson<{ token: string; user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getMe(token: string) {
  return fetchJson<User>("/api/me", { token });
}

export async function getGames() {
  const data = await fetchJson<{ items: Game[] }>("/api/games");
  return data.items;
}

export async function getEvents(params: {
  regionIds?: string;
  types?: string;
  status?: string;
  q?: string;
  visibility?: string;
}, token?: string) {
  const query = buildQuery({ ...params, sort: "start_at", limit: "100" });
  const data = await fetchJson<{ items: EventItem[] }>(`/api/events?${query}`, { token });
  return data.items;
}

export async function getEventById(id: number, token?: string) {
  return fetchJson<EventItem>(`/api/events/${id}`, { token });
}

export async function getPickupSnapshotLatest() {
  return fetchJson<PickupSnapshot>("/api/pickup-snapshot/latest");
}

export async function getMyFeed(token: string) {
  const data = await fetchJson<{ items: EventItem[] }>("/api/me/feed", { token });
  return data.items;
}

export async function getMyGames(token: string) {
  const data = await fetchJson<{ items: UserGame[] }>("/api/me/games", { token });
  return data.items;
}

export async function saveMyGame(token: string, payload: { regionId: number; enabled?: boolean }) {
  return fetchJson<{ ok: boolean }>("/api/me/games", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function removeMyGame(token: string, regionId: number) {
  return fetchJson<{ ok: boolean }>(`/api/me/games/${regionId}`, {
    method: "DELETE",
    token
  });
}

export async function getNotificationRules(token: string) {
  const data = await fetchJson<{ items: NotificationRule[] }>("/api/me/notification-rules", { token });
  return data.items;
}

export async function createNotificationRule(
  token: string,
  payload: {
    scope: "GLOBAL" | "REGION";
    regionId?: number | null;
    eventType: EventItem["type"];
    trigger: NotificationRule["trigger"];
    offsetMinutes?: number | null;
    channel: NotificationRule["channel"];
    enabled?: boolean;
  }
) {
  return fetchJson<{ id: number }>("/api/me/notification-rules", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updateNotificationRule(
  token: string,
  ruleId: number,
  payload: Partial<{
    scope: "GLOBAL" | "REGION";
    regionId: number | null;
    eventType: EventItem["type"];
    trigger: NotificationRule["trigger"];
    offsetMinutes: number | null;
    channel: NotificationRule["channel"];
    enabled: boolean;
  }>
) {
  return fetchJson<{ ok: boolean }>(`/api/me/notification-rules/${ruleId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload)
  });
}

export async function deleteNotificationRule(token: string, ruleId: number) {
  return fetchJson<{ ok: boolean }>(`/api/me/notification-rules/${ruleId}`, {
    method: "DELETE",
    token
  });
}

export async function getMySchedules(token: string) {
  const data = await fetchJson<{ items: NotificationSchedule[] }>("/api/me/notification-schedules", { token });
  return data.items;
}

export async function getSources(token: string, dueOnly = false) {
  const query = dueOnly ? "?due=1" : "";
  const data = await fetchJson<{ items: SourceItem[] }>(`/api/admin/sources${query}`, {
    token
  });
  return data.items;
}

export async function createGame(token: string, payload: { slug: string; name: string; iconUrl?: string | null }) {
  return fetchJson<{ id: number }>("/api/admin/games", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function createRegion(token: string, payload: { gameId: number; code: string; timezone: string }) {
  return fetchJson<{ id: number }>("/api/admin/regions", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function createSource(
  token: string,
  payload: {
    regionId: number;
    type: SourceItem["type"];
    baseUrl: string;
    listUrl?: string | null;
    enabled?: boolean;
    fetchIntervalMinutes?: number;
    configJson?: Record<string, unknown>;
  }
) {
  return fetchJson<{ id: number }>("/api/admin/sources", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function runSourceFetch(token: string, sourceId: number) {
  return fetchJson<{ sourceId: number; fetchedCount: number; parsedCount: number; errorCount: number; status: string }>(
    `/api/admin/sources/${sourceId}/run-fetch`,
    {
      method: "POST",
      token
    }
  );
}

export async function runDueIngest(token: string) {
  return fetchJson<{ processedSources: number }>("/api/admin/ingest/run-due", {
    method: "POST",
    token
  });
}

export async function runDueDispatch(token: string) {
  return fetchJson<{ picked: number; sent: number; failed: number }>("/api/admin/notifications/dispatch-due", {
    method: "POST",
    token
  });
}

export async function getRawNotices(token: string, status?: "NEW" | "PARSED" | "ERROR") {
  const query = status ? `?status=${status}` : "";
  const data = await fetchJson<{ items: Array<Record<string, unknown>> }>(`/api/admin/raw-notices${query}`, {
    token
  });
  return data.items;
}

export async function reparseRawNotice(token: string, rawNoticeId: number) {
  return fetchJson<{ eventId: number }>(`/api/admin/raw-notices/${rawNoticeId}/reparse`, {
    method: "POST",
    token
  });
}

export async function getIngestRuns(token: string) {
  const data = await fetchJson<{ items: IngestRun[] }>("/api/admin/ingest-runs", {
    token
  });
  return data.items;
}

export async function patchEvent(
  token: string,
  eventId: number,
  payload: Partial<{
    type: EventItem["type"];
    title: string;
    summary: string | null;
    startAtUtc: string | null;
    endAtUtc: string | null;
    visibility: "PUBLIC" | "NEED_REVIEW" | "HIDDEN";
  }>
) {
  return fetchJson<{ ok: boolean }>(`/api/admin/events/${eventId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload)
  });
}
