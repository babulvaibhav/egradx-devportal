'use client';

import { useState } from 'react';
import { useInbox } from '@babulvaibhav/egradx-react';

// docs:region web-bell
/**
 * The notification bell, on the SDK's inbox: the unread count, a live stream of new notices, read state. Use the inbox
 * once, high in the page: each use opens a stream of its own.
 */
export function Bell({ onNotification }: { onNotification?: () => void }) {
  const inbox = useInbox({ onNotification: () => onNotification?.() });
  const [open, setOpen] = useState(false);
  return (
    <div className="bell">
      <button aria-label={`Notifications, ${inbox.unreadCount} unread`} onClick={() => setOpen(!open)}>
        🔔 {inbox.unreadCount > 0 ? <span className="badge">{inbox.unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="panel">
          <div className="panel-head">
            <strong>Notifications</strong>
            <button className="link" onClick={() => void inbox.markAllRead()}>
              Mark all read
            </button>
          </div>
          {inbox.items.length === 0 ? <p className="muted">You are all caught up.</p> : null}
          {inbox.items.map((item) => (
            <button key={item.id} className={item.readAt ? 'item' : 'item unread'} onClick={() => void inbox.markRead(item.id!)}>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
// docs:end
