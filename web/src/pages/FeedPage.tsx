import { FormEvent, useEffect, useMemo, useState } from "react";
import { EventItem, Game, getEvents, getGames, getMyFeed, isApiError } from "../api";
import { EmptyState, EventCard } from "../ui";

type FeedMode = "all" | "my";

export function FeedPage({ mode, token }: { mode: FeedMode; token: string | null }) {
  const [games, setGames] = useState<Game[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [regionId, setRegionId] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    getGames()
      .then(setGames)
      .catch((err) => setError(isApiError(err) ? err.message : "Failed to load games"));
  }, []);

  const fetchEvents = async () => {
    if (mode === "my" && !token) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const items =
        mode === "my"
          ? await getMyFeed(token!)
          : await getEvents(
              {
                regionIds: regionId || undefined,
                types: type || undefined,
                status: status || undefined,
                q: keyword || undefined
              },
              token ?? undefined
            );

      const filtered =
        mode === "my"
          ? items.filter((item) => {
              if (regionId && String(item.region.id) !== regionId) return false;
              if (type && item.type !== type) return false;
              if (status) {
                const now = Date.now();
                const start = item.startAtUtc ? new Date(item.startAtUtc).getTime() : null;
                const end = item.endAtUtc ? new Date(item.endAtUtc).getTime() : null;
                const state = start && start > now ? "UPCOMING" : end && end < now ? "ENDED" : "ONGOING";
                if (state !== status) return false;
              }
              if (keyword) {
                const merged = `${item.title} ${item.summary ?? ""}`.toLowerCase();
                if (!merged.includes(keyword.toLowerCase())) return false;
              }
              return true;
            })
          : items;

      setEvents(filtered);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEvents();
  }, [mode, token, regionId, type, status, keyword]);

  const regionOptions = useMemo(() => {
    return games.flatMap((game) =>
      game.regions.map((region) => ({
        id: region.id,
        label: `${game.name} (${region.code})`
      }))
    );
  }, [games]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void fetchEvents();
  };

  if (mode === "my" && !token) {
    return <EmptyState message="Login required to view My Feed." />;
  }

  return (
    <div className="section">
      <h2>{mode === "my" ? "My Feed" : "All Feed"}</h2>
      <form className="filters" onSubmit={onSubmit}>
        <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
          <option value="">All Regions</option>
          {regionOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All Types</option>
          <option value="PICKUP">PICKUP</option>
          <option value="UPDATE">UPDATE</option>
          <option value="MAINTENANCE">MAINTENANCE</option>
          <option value="EVENT">EVENT</option>
          <option value="CAMPAIGN">CAMPAIGN</option>
        </select>

        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="UPCOMING">UPCOMING</option>
          <option value="ONGOING">ONGOING</option>
          <option value="ENDED">ENDED</option>
        </select>

        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Search title/summary" />
        <button type="submit">Refresh</button>
      </form>

      {loading ? <p className="panel">Loading events...</p> : null}
      {error ? <p className="panel error-text">{error}</p> : null}
      {!loading && !error && events.length === 0 ? <EmptyState message="No events found." /> : null}

      {!loading && !error && events.length > 0 ? (
        <ul className="event-list">
          {events.map((item) => (
            <EventCard key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
