import { FormEvent, useEffect, useState } from "react";
import {
  createGame,
  createRegion,
  createSource,
  Game,
  getGames,
  getIngestRuns,
  getRawNotices,
  getSources,
  IngestRun,
  isApiError,
  reparseRawNotice,
  runDueDispatch,
  runDueIngest,
  runSourceFetch,
  SourceItem
} from "../api";
import { formatDate } from "../ui";

export function AdminPage({ token }: { token: string | null }) {
  const [games, setGames] = useState<Game[]>([]);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [rawNotices, setRawNotices] = useState<Array<Record<string, unknown>>>([]);
  const [runs, setRuns] = useState<IngestRun[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [newGameSlug, setNewGameSlug] = useState("");
  const [newGameName, setNewGameName] = useState("");

  const [regionGameId, setRegionGameId] = useState("");
  const [regionCode, setRegionCode] = useState("KR");
  const [regionTimezone, setRegionTimezone] = useState("Asia/Seoul");

  const [sourceRegionId, setSourceRegionId] = useState("");
  const [sourceType, setSourceType] = useState<SourceItem["type"]>("RSS");
  const [sourceBaseUrl, setSourceBaseUrl] = useState("");
  const [sourceListUrl, setSourceListUrl] = useState("");

  const load = async () => {
    if (!token) return;

    try {
      const [gamesData, sourcesData, rawData, runData] = await Promise.all([
        getGames(),
        getSources(token),
        getRawNotices(token, "ERROR"),
        getIngestRuns(token)
      ]);

      setGames(gamesData);
      setSources(sourcesData);
      setRawNotices(rawData);
      setRuns(runData);
      setMessage(null);
    } catch (err) {
      setMessage(isApiError(err) ? err.message : "Failed to load admin data");
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  if (!token) return <p className="panel">Admin token required.</p>;

  const regionOptions = games.flatMap((game) => game.regions.map((region) => ({ game, region })));

  const onCreateGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await createGame(token, {
        slug: newGameSlug,
        name: newGameName
      });
      setNewGameSlug("");
      setNewGameName("");
      await load();
      setMessage("Game created/updated.");
    } catch (err) {
      setMessage(isApiError(err) ? err.message : "Failed to create game");
    }
  };

  const onCreateRegion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!regionGameId) return;

    try {
      await createRegion(token, {
        gameId: Number(regionGameId),
        code: regionCode,
        timezone: regionTimezone
      });
      await load();
      setMessage("Region created/updated.");
    } catch (err) {
      setMessage(isApiError(err) ? err.message : "Failed to create region");
    }
  };

  const onCreateSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sourceRegionId) return;

    try {
      await createSource(token, {
        regionId: Number(sourceRegionId),
        type: sourceType,
        baseUrl: sourceBaseUrl,
        listUrl: sourceListUrl || null,
        fetchIntervalMinutes: 60,
        configJson: {
          timezone: "Asia/Seoul"
        }
      });
      setSourceBaseUrl("");
      setSourceListUrl("");
      await load();
      setMessage("Source created.");
    } catch (err) {
      setMessage(isApiError(err) ? err.message : "Failed to create source");
    }
  };

  return (
    <div className="section grid-two">
      <div className="panel">
        <h3>Admin Actions</h3>
        <div className="row">
          <button
            onClick={() =>
              void runDueIngest(token)
                .then((result) => setMessage(`Due ingest processed: ${result.processedSources}`))
                .catch((err) => setMessage(isApiError(err) ? err.message : "Failed to run due ingest"))
            }
          >
            Run due ingest
          </button>
          <button
            onClick={() =>
              void runDueDispatch(token)
                .then((result) =>
                  setMessage(`Dispatch result - picked: ${result.picked}, sent: ${result.sent}, failed: ${result.failed}`)
                )
                .catch((err) => setMessage(isApiError(err) ? err.message : "Failed to dispatch notifications"))
            }
          >
            Dispatch due notifications
          </button>
        </div>
        {message ? <p className="muted">{message}</p> : null}
      </div>

      <div className="panel">
        <h3>Create Game</h3>
        <form className="stack" onSubmit={onCreateGame}>
          <input value={newGameSlug} onChange={(e) => setNewGameSlug(e.target.value)} placeholder="slug" required />
          <input value={newGameName} onChange={(e) => setNewGameName(e.target.value)} placeholder="name" required />
          <button type="submit">Save game</button>
        </form>
      </div>

      <div className="panel">
        <h3>Create Region</h3>
        <form className="stack" onSubmit={onCreateRegion}>
          <select value={regionGameId} onChange={(e) => setRegionGameId(e.target.value)} required>
            <option value="">Select game</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
          <input value={regionCode} onChange={(e) => setRegionCode(e.target.value)} placeholder="code" />
          <input value={regionTimezone} onChange={(e) => setRegionTimezone(e.target.value)} placeholder="timezone" />
          <button type="submit">Save region</button>
        </form>
      </div>

      <div className="panel">
        <h3>Create Source</h3>
        <form className="stack" onSubmit={onCreateSource}>
          <select value={sourceRegionId} onChange={(e) => setSourceRegionId(e.target.value)} required>
            <option value="">Select region</option>
            {regionOptions.map(({ game, region }) => (
              <option key={region.id} value={region.id}>
                {game.name} ({region.code})
              </option>
            ))}
          </select>
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceItem["type"])}>
            <option value="RSS">RSS</option>
            <option value="HTML_LIST">HTML_LIST</option>
            <option value="HTML_DETAIL">HTML_DETAIL</option>
            <option value="API">API</option>
          </select>
          <input value={sourceBaseUrl} onChange={(e) => setSourceBaseUrl(e.target.value)} placeholder="base url" required />
          <input value={sourceListUrl} onChange={(e) => setSourceListUrl(e.target.value)} placeholder="list url" />
          <button type="submit">Save source</button>
        </form>
      </div>

      <div className="panel full-width">
        <h3>Sources</h3>
        <ul className="simple-list">
          {sources.map((source) => (
            <li key={source.id}>
              <span>
                #{source.id} {source.gameName} ({source.regionCode}) [{source.type}] interval={source.fetchIntervalMinutes}m
              </span>
              <button
                onClick={() =>
                  void runSourceFetch(token, source.id)
                    .then((result) =>
                      setMessage(
                        `Source ${source.id}: fetched=${result.fetchedCount}, parsed=${result.parsedCount}, errors=${result.errorCount}`
                      )
                    )
                    .catch((err) => setMessage(isApiError(err) ? err.message : "Run fetch failed"))
                }
              >
                Run fetch
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel full-width">
        <h3>Raw Notice Errors</h3>
        <ul className="simple-list">
          {rawNotices.map((notice) => (
            <li key={String(notice.id)}>
              <span>
                #{String(notice.id)} [{String(notice.gameName)} {String(notice.regionCode)}] {String(notice.title)}
              </span>
              <button
                onClick={() =>
                  void reparseRawNotice(token, Number(notice.id))
                    .then(() => setMessage(`Reparse queued for raw notice ${String(notice.id)}`))
                    .catch((err) => setMessage(isApiError(err) ? err.message : "Reparse failed"))
                }
              >
                Reparse
              </button>
            </li>
          ))}
          {rawNotices.length === 0 ? <li>No parse errors.</li> : null}
        </ul>
      </div>

      <div className="panel full-width">
        <h3>Ingest Runs</h3>
        <ul className="simple-list">
          {runs.slice(0, 50).map((run) => (
            <li key={run.id}>
              <span>
                {formatDate(run.startedAt)} | {run.mode} | {run.status} | fetched={run.fetchedCount} parsed={run.parsedCount}
                error={run.errorCount} | {run.gameName ?? "-"} ({run.regionCode ?? "-"})
              </span>
            </li>
          ))}
          {runs.length === 0 ? <li>No ingest runs yet.</li> : null}
        </ul>
      </div>
    </div>
  );
}
