import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { EventItem, getEvents, getPickupSnapshotLatest, isApiError, PickupSnapshot } from "../api";
import { EventBadge, formatDate } from "../ui";

function isTodayLocal(value: string | null | undefined) {
  if (!value) return false;
  const target = new Date(value);
  const now = new Date();
  return (
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate()
  );
}

function toStatus(item: EventItem) {
  const now = Date.now();
  const start = item.startAtUtc ? new Date(item.startAtUtc).getTime() : null;
  const end = item.endAtUtc ? new Date(item.endAtUtc).getTime() : null;
  if (start && start > now) return "UPCOMING";
  if (end && end < now) return "ENDED";
  return "ONGOING";
}

export function HomePage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [snapshot, setSnapshot] = useState<PickupSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    Promise.all([getEvents({}), getPickupSnapshotLatest()])
      .then(([eventItems, pickupSnapshot]) => {
        setEvents(eventItems);
        setSnapshot(pickupSnapshot);
      })
      .catch((err) => {
        setError(isApiError(err) ? err.message : "Failed to load dashboard");
      })
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const startsToday = events.filter((item) => isTodayLocal(item.startAtUtc)).length;
    const endsToday = events.filter((item) => isTodayLocal(item.endAtUtc)).length;
    const ongoingPickup = events.filter((item) => item.type === "PICKUP" && toStatus(item) === "ONGOING").length;
    return { startsToday, endsToday, ongoingPickup };
  }, [events]);

  const upcoming = useMemo(() => {
    return events
      .filter((item) => toStatus(item) !== "ENDED")
      .sort((a, b) => {
        const av = a.startAtUtc ? Date.parse(a.startAtUtc) : Number.MAX_SAFE_INTEGER;
        const bv = b.startAtUtc ? Date.parse(b.startAtUtc) : Number.MAX_SAFE_INTEGER;
        return av - bv;
      })
      .slice(0, 6);
  }, [events]);

  const spotlight = useMemo(() => snapshot?.items.slice(0, 6) ?? [], [snapshot]);

  return (
    <section className="section home-section">
      <div className="hero panel reveal">
        <p className="hero-kicker">Subculture Game Hub</p>
        <h1>픽업, 점검, 업데이트를 한 곳에서</h1>
        <p className="hero-copy">
          게임별 공지를 직접 돌아다니지 않아도 됩니다. 공식 공지 링크 기준으로 이벤트를 모아 보고, 원하는 게임만 골라 알림을 준비하세요.
        </p>
        <div className="hero-actions">
          <Link to="/feed" className="ghost-link">
            전체 피드 보기
          </Link>
          <Link to="/pickup-snapshot" className="ghost-link">
            픽업 스냅샷 보기
          </Link>
        </div>
      </div>

      {loading ? <p className="panel">Loading dashboard...</p> : null}
      {error ? <p className="panel error-text">{error}</p> : null}

      {!loading && !error ? (
        <>
          <div className="home-stats">
            <article className="panel stat-card reveal">
              <p className="stat-label">오늘 시작</p>
              <strong>{stats.startsToday}</strong>
            </article>
            <article className="panel stat-card reveal">
              <p className="stat-label">오늘 종료</p>
              <strong>{stats.endsToday}</strong>
            </article>
            <article className="panel stat-card reveal">
              <p className="stat-label">진행중 픽업</p>
              <strong>{stats.ongoingPickup}</strong>
            </article>
            <article className="panel stat-card reveal">
              <p className="stat-label">최신 스냅샷</p>
              <strong>{snapshot?.itemCount ?? 0}</strong>
            </article>
          </div>

          <div className="home-grid">
            <div className="panel reveal">
              <div className="row">
                <h3>공식 공지 픽업 하이라이트</h3>
                <Link to="/pickup-snapshot">더 보기</Link>
              </div>
              <p className="muted">{snapshot?.copyrightNotice ?? "Official notice links only."}</p>
              <div className="spotlight-grid">
                {spotlight.map((item) => (
                  <article className="spotlight-card" key={`${item.game}-${item.sourceUrl}`}>
                    <div className="spotlight-thumb">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.game} loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="spotlight-fallback">{item.game}</div>
                      )}
                    </div>
                    <p className="meta">
                      {item.game} ({item.region})
                    </p>
                    <p className="spotlight-title">{item.title}</p>
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                      공식 공지 열기
                    </a>
                  </article>
                ))}
              </div>
            </div>

            <div className="panel reveal">
              <div className="row">
                <h3>다가오는 이벤트</h3>
                <Link to="/feed">전체 일정</Link>
              </div>
              <ul className="simple-list upcoming-list">
                {upcoming.map((item) => (
                  <li key={item.id}>
                    <div>
                      <p className="meta">
                        {item.game.name} ({item.region.code})
                      </p>
                      <p className="spotlight-title">{item.title}</p>
                      <p className="meta">{formatDate(item.startAtUtc)}</p>
                    </div>
                    <div className="upcoming-actions">
                      <EventBadge type={item.type} />
                      <Link to={`/events/${item.id}`}>상세</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
