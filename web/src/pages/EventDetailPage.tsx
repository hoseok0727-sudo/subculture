import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createNotificationRule, EventItem, getEventById, isApiError } from "../api";
import { EventBadge, formatDate } from "../ui";

export function EventDetailPage({ token }: { token: string | null }) {
  const { eventId } = useParams();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;

    setLoading(true);
    setError(null);

    getEventById(Number(eventId), token ?? undefined)
      .then(setEvent)
      .catch((err) => setError(isApiError(err) ? err.message : "Failed to load event"))
      .finally(() => setLoading(false));
  }, [eventId, token]);

  const addQuickRule = async (kind: "start" | "end24") => {
    if (!token || !event) {
      setMessage("Login required.");
      return;
    }

    try {
      if (kind === "start") {
        await createNotificationRule(token, {
          scope: "GLOBAL",
          eventType: event.type,
          trigger: "ON_START",
          channel: "WEBPUSH",
          enabled: true
        });
      } else {
        await createNotificationRule(token, {
          scope: "GLOBAL",
          eventType: event.type,
          trigger: "BEFORE_END",
          offsetMinutes: 24 * 60,
          channel: "WEBPUSH",
          enabled: true
        });
      }
      setMessage("Notification rule added.");
    } catch (err) {
      setMessage(isApiError(err) ? err.message : "Failed to add rule.");
    }
  };

  if (loading) return <p className="panel">Loading detail...</p>;
  if (error) return <p className="panel error-text">{error}</p>;
  if (!event) return <p className="panel">Event not found.</p>;

  return (
    <div className="section detail-card">
      <p>
        <Link to="/feed">Back to feed</Link>
      </p>
      <div className="event-head">
        <EventBadge type={event.type} />
        <h2>{event.title}</h2>
      </div>
      <p className="meta">
        {event.game.name} ({event.region.code})
      </p>
      <p>
        <strong>Period:</strong> {formatDate(event.startAtUtc)} - {formatDate(event.endAtUtc)}
      </p>
      <p>
        <strong>Summary:</strong> {event.summary ?? "(none)"}
      </p>
      <p>
        <strong>Confidence:</strong> {Math.round(event.confidence * 100)}%
      </p>
      <p>
        <a href={event.sourceUrl} target="_blank" rel="noreferrer">
          Original notice
        </a>
      </p>

      <div className="quick-actions">
        <button onClick={() => void addQuickRule("start")}>Alert on start</button>
        <button onClick={() => void addQuickRule("end24")}>Alert 24h before end</button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
