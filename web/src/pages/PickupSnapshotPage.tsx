import { useEffect, useMemo, useState } from "react";
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

  const grouped = useMemo(() => {
    const map = new Map<string, PickupSnapshot["items"]>();
    for (const item of snapshot?.items ?? []) {
      const key = `${item.game} (${item.region})`;
      const current = map.get(key) ?? [];
      current.push(item);
      map.set(key, current);
    }
    return Array.from(map.entries());
  }, [snapshot]);

  return (
    <section className="section">
      <div className="panel hero mini-hero reveal">
        <p className="hero-kicker">Pickup Snapshot</p>
        <h2>공식 공지 기반 수집 테스트</h2>
        <p className="hero-copy">
          원문 URL 기준으로 최신 픽업 공지를 모아서 보여줍니다. 이미지가 있는 경우 원본 페이지 이미지 URL을 그대로 사용합니다.
        </p>
      </div>

      {loading ? <p className="panel">Loading pickup snapshot...</p> : null}
      {error ? <p className="panel error-text">{error}</p> : null}

      {!loading && !error && snapshot ? (
        <>
          <div className="panel reveal">
            <p className="meta">
              <strong>Report:</strong> {snapshot.file}
            </p>
            <p className="meta">
              <strong>Generated:</strong> {formatDate(snapshot.generatedAt)}
            </p>
            <p className="meta">
              <strong>Items:</strong> {snapshot.itemCount}
            </p>
            <p className="muted">{snapshot.copyrightNotice}</p>
            {snapshot.failures.length > 0 ? (
              <ul className="simple-list">
                {snapshot.failures.map((failure) => (
                  <li key={failure}>{failure}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {grouped.map(([group, items]) => (
            <div className="panel reveal" key={group}>
              <h3>{group}</h3>
              <div className="spotlight-grid">
                {items.map((item) => (
                  <article className="spotlight-card" key={`${item.game}-${item.sourceUrl}`}>
                    <div className="spotlight-thumb">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.title} loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="spotlight-fallback">{item.game}</div>
                      )}
                    </div>
                    <p className="spotlight-title">{item.note ? `${item.title} (${item.note})` : item.title}</p>
                    <p className="meta">
                      {formatDate(item.startAtUtc)} - {formatDate(item.endAtUtc)}
                    </p>
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                      공식 공지 열기
                    </a>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}
