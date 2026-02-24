import { useEffect, useState } from "react";
import { getPickupSnapshotLatest, isApiError, PickupSnapshot } from "../api";
import { formatDate } from "../ui";

export function PickupSnapshotPage() {
  const [snapshot, setSnapshot] = useState<PickupSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    getPickupSnapshotLatest()
      .then(setSnapshot)
      .catch((err) => {
        setError(isApiError(err) ? err.message : "Failed to load pickup snapshot");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="section">
      <h2>Pickup Snapshot</h2>
      <p className="muted">수집 테스트 결과를 웹에서 UTF-8로 그대로 확인하는 화면입니다.</p>

      {loading ? <p className="panel">Loading pickup snapshot...</p> : null}
      {error ? <p className="panel error-text">{error}</p> : null}

      {!loading && !error && snapshot ? (
        <>
          <div className="panel">
            <p className="meta">
              <strong>Report:</strong> {snapshot.file}
            </p>
            <p className="meta">
              <strong>Generated:</strong> {formatDate(snapshot.generatedAt)}
            </p>
            <p className="meta">
              <strong>Items:</strong> {snapshot.itemCount}
            </p>
            {snapshot.failures.length > 0 ? (
              <div>
                <strong>Failures</strong>
                <ul className="simple-list">
                  {snapshot.failures.map((failure) => (
                    <li key={failure}>{failure}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="panel table-wrap">
            <table className="snapshot-table">
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
                {snapshot.items.map((item) => (
                  <tr key={`${item.game}-${item.sourceUrl}`}>
                    <td>{item.game}</td>
                    <td>{item.region}</td>
                    <td>{item.note ? `${item.title} (${item.note})` : item.title}</td>
                    <td>{item.startAtUtc ? formatDate(item.startAtUtc) : "TBD"}</td>
                    <td>{item.endAtUtc ? formatDate(item.endAtUtc) : "TBD"}</td>
                    <td>
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                        source
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
