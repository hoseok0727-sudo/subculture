import { Link, NavLink } from "react-router-dom";
import { EventItem, User } from "./api";

export function formatDate(value?: string | null) {
  if (!value) return "TBD";
  return new Date(value).toLocaleString();
}

export function calcStatus(startAt?: string | null, endAt?: string | null) {
  const now = Date.now();
  const start = startAt ? new Date(startAt).getTime() : null;
  const end = endAt ? new Date(endAt).getTime() : null;

  if (start && start > now) return "UPCOMING";
  if (end && end < now) return "ENDED";
  return "ONGOING";
}

export function EventBadge({ type }: { type: EventItem["type"] }) {
  return <span className={`badge badge-${type.toLowerCase()}`}>{type}</span>;
}

export function EventCard({ item }: { item: EventItem }) {
  return (
    <li className="event-item">
      <Link to={`/events/${item.id}`}>
        <div className="event-head">
          <EventBadge type={item.type} />
          <strong>{item.title}</strong>
        </div>
        <p className="meta">
          {item.game.name} ({item.region.code})
        </p>
        <p className="meta">
          {formatDate(item.startAtUtc)} - {formatDate(item.endAtUtc)}
        </p>
        <p className="meta">Status: {calcStatus(item.startAtUtc, item.endAtUtc)}</p>
      </Link>
    </li>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="panel">{message}</p>;
}

export function AppHeader({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  return (
    <header className="topbar">
      <div className="brand">
        <Link to="/feed">Subculture Hub</Link>
      </div>
      <nav className="nav-links">
        <NavLink to="/feed">All Feed</NavLink>
        <NavLink to="/my-feed">My Feed</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        {user?.role === "ADMIN" ? <NavLink to="/admin">Admin</NavLink> : null}
      </nav>
      <div className="auth-zone">
        {user ? (
          <>
            <span className="user-chip">{user.email}</span>
            <button onClick={onLogout}>Logout</button>
          </>
        ) : (
          <>
            <NavLink to="/login">Login</NavLink>
            <NavLink to="/signup">Sign up</NavLink>
          </>
        )}
      </div>
    </header>
  );
}
