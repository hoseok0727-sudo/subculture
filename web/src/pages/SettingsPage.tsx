import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createNotificationRule,
  deleteNotificationRule,
  Game,
  getGames,
  getMyGames,
  getMySchedules,
  getNotificationRules,
  isApiError,
  NotificationRule,
  NotificationSchedule,
  removeMyGame,
  saveMyGame,
  UserGame
} from "../api";
import { formatDate } from "../ui";

export function SettingsPage({ token }: { token: string | null }) {
  const [games, setGames] = useState<Game[]>([]);
  const [myGames, setMyGames] = useState<UserGame[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [schedules, setSchedules] = useState<NotificationSchedule[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newRuleType, setNewRuleType] = useState<NotificationRule["eventType"]>("PICKUP");
  const [newRuleTrigger, setNewRuleTrigger] = useState<NotificationRule["trigger"]>("ON_START");
  const [newRuleOffset, setNewRuleOffset] = useState("1440");
  const [newRuleChannel, setNewRuleChannel] = useState<NotificationRule["channel"]>("WEBPUSH");

  const selectedRegionIds = useMemo(() => new Set(myGames.map((item) => item.regionId)), [myGames]);

  const loadData = async () => {
    if (!token) return;

    try {
      const [gamesData, myGamesData, rulesData, schedulesData] = await Promise.all([
        getGames(),
        getMyGames(token),
        getNotificationRules(token),
        getMySchedules(token)
      ]);

      setGames(gamesData);
      setMyGames(myGamesData);
      setRules(rulesData);
      setSchedules(schedulesData);
      setError(null);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to load settings");
    }
  };

  useEffect(() => {
    void loadData();
  }, [token]);

  if (!token) {
    return <p className="panel">Login required to manage settings.</p>;
  }

  const onToggleRegion = async (regionId: number, enabled: boolean) => {
    try {
      if (enabled) {
        await saveMyGame(token, { regionId, enabled: true });
      } else {
        await removeMyGame(token, regionId);
      }
      await loadData();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to update game");
    }
  };

  const onCreateRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      await createNotificationRule(token, {
        scope: "GLOBAL",
        eventType: newRuleType,
        trigger: newRuleTrigger,
        offsetMinutes: newRuleTrigger.includes("BEFORE") ? Number(newRuleOffset || "0") : null,
        channel: newRuleChannel,
        enabled: true
      });
      await loadData();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to create rule");
    }
  };

  const onDeleteRule = async (ruleId: number) => {
    try {
      await deleteNotificationRule(token, ruleId);
      await loadData();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Failed to delete rule");
    }
  };

  return (
    <div className="section grid-two">
      <div className="panel">
        <h3>My Games</h3>
        {games.flatMap((game) =>
          game.regions.map((region) => {
            const checked = selectedRegionIds.has(region.id);
            return (
              <label key={`${game.id}-${region.id}`} className="row">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => void onToggleRegion(region.id, e.target.checked)}
                />
                <span>
                  {game.name} ({region.code})
                </span>
              </label>
            );
          })
        )}
      </div>

      <div className="panel">
        <h3>Notification Rules</h3>
        <form className="stack" onSubmit={onCreateRule}>
          <select value={newRuleType} onChange={(e) => setNewRuleType(e.target.value as NotificationRule["eventType"])}>
            <option value="PICKUP">PICKUP</option>
            <option value="UPDATE">UPDATE</option>
            <option value="MAINTENANCE">MAINTENANCE</option>
            <option value="EVENT">EVENT</option>
            <option value="CAMPAIGN">CAMPAIGN</option>
          </select>
          <select
            value={newRuleTrigger}
            onChange={(e) => setNewRuleTrigger(e.target.value as NotificationRule["trigger"])}
          >
            <option value="ON_START">ON_START</option>
            <option value="ON_END">ON_END</option>
            <option value="BEFORE_END">BEFORE_END</option>
            <option value="BEFORE_START">BEFORE_START</option>
            <option value="ON_PUBLISH">ON_PUBLISH</option>
          </select>
          {newRuleTrigger.includes("BEFORE") ? (
            <input
              value={newRuleOffset}
              onChange={(e) => setNewRuleOffset(e.target.value)}
              type="number"
              min={0}
              placeholder="Offset minutes"
            />
          ) : null}
          <select value={newRuleChannel} onChange={(e) => setNewRuleChannel(e.target.value as NotificationRule["channel"])}>
            <option value="WEBPUSH">WEBPUSH</option>
            <option value="EMAIL">EMAIL</option>
            <option value="DISCORD">DISCORD</option>
          </select>
          <button type="submit">Add rule</button>
        </form>

        <ul className="simple-list">
          {rules.map((rule) => (
            <li key={rule.id}>
              <span>
                {rule.eventType} / {rule.trigger}
                {rule.offsetMinutes ? ` (${rule.offsetMinutes}m)` : ""} / {rule.channel}
              </span>
              <button onClick={() => void onDeleteRule(rule.id)}>Delete</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel full-width">
        <h3>Upcoming Notification Schedules</h3>
        <ul className="simple-list">
          {schedules.slice(0, 50).map((schedule) => (
            <li key={schedule.id}>
              <span>
                {formatDate(schedule.scheduledAtUtc)} | {schedule.gameName} ({schedule.regionCode}) | {schedule.eventTitle} |{" "}
                {schedule.channel} | {schedule.status}
              </span>
            </li>
          ))}
          {schedules.length === 0 ? <li>No schedules yet.</li> : null}
        </ul>
      </div>

      {error ? <p className="error-text full-width">{error}</p> : null}
    </div>
  );
}
