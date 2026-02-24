import dotenv from "dotenv";

dotenv.config();

const apiBase = process.env.WORKER_API_BASE ?? "http://localhost:4000";
const adminApiKey = process.env.ADMIN_API_KEY ?? "dev-admin-key";
const tickMs = Number(process.env.WORKER_TICK_MS ?? 20000);

async function postJson(path: string, query = "") {
  const url = `${apiBase}${path}${query}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-admin-key": adminApiKey,
      "content-type": "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }

  return response.json();
}

async function tick() {
  const startedAt = new Date().toISOString();

  try {
    const ingest = await postJson("/api/admin/ingest/run-due");
    const dispatch = await postJson("/api/admin/notifications/dispatch-due", "?limit=200");

    console.log(
      `[worker] ${startedAt} ingest=${ingest.processedSources ?? 0} dispatchPicked=${dispatch.picked ?? 0} sent=${dispatch.sent ?? 0} failed=${dispatch.failed ?? 0}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    console.error(`[worker] ${startedAt} failed: ${message}`);
  }
}

console.log("Worker started");
console.log(`WORKER_API_BASE=${apiBase}`);
console.log(`WORKER_TICK_MS=${tickMs}`);

void tick();
setInterval(() => {
  void tick();
}, tickMs);
