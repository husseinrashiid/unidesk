import { Bell, CheckCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Modal, Button, Empty } from "../../components/ui";
import { query, batch } from "../../services/platform";
import { useWorkspace } from "../../hooks/useWorkspace";
import type { Reminder } from "../../types";
export function NotificationCenter({ onClose }: { onClose: () => void }) {
  const { navigate, refresh, report } = useWorkspace();
  const { data: notifications = [], error } = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      query<Reminder>(
        "SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100",
      ),
  });
  return (
    <Modal title="Notifications" onClose={onClose}>
      <div className="notification-toolbar">
        <span className="muted small">
          {notifications.filter((n) => !n.read).length} unread
        </span>
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              await batch([
                { sql: "UPDATE notifications SET read=1 WHERE read=0" },
              ]);
              await refresh();
            } catch (e) {
              report((e as Error).message);
            }
          }}
        >
          <CheckCheck size={15} />
          Mark all read
        </Button>
      </div>
      {error ? (
        <p role="alert">Could not load reminders.</p>
      ) : notifications.length ? (
        <div className="notification-list">
          {notifications.map((n) => (
            <button
              key={n.id}
              className={`notification-row ${n.read ? "read" : ""}`}
              onClick={async () => {
                try {
                  await batch([
                    {
                      sql: "UPDATE notifications SET read=1 WHERE id=?",
                      params: [n.id],
                    },
                  ]);
                  await refresh();
                  navigate(
                    n.type === "study"
                      ? "study/planner"
                      : n.type === "email"
                        ? `email/${encodeURIComponent(n.entity_id)}`
                        : `${n.type}/${n.entity_id}`,
                  );
                  onClose();
                } catch (e) {
                  report((e as Error).message);
                }
              }}
            >
              <Bell size={16} />
              <span>
                <strong>{n.title}</strong>
                <small>{n.description}</small>
              </span>
              {!n.read && <span className="unread-dot" />}
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title="You’re all caught up"
          description="Exam and assignment reminders will appear here."
        />
      )}
      <div className="notification-footer">
        Reminders are checked while UniDesk is open and when it starts.
      </div>
    </Modal>
  );
}
