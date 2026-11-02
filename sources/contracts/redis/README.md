# Redis: what the egradx-redis packages share

`egradx-redis` (Java), `@babulvaibhav/egradx-redis` (Node) and `egradx-redis` (Python) make several instances of an
application act as one, through Redis. They use the same keys, channels and messages, so instances in different
languages behind one Redis count, evict and push together. This file is that agreement; each SDK tests against
[`messages.json`](messages.json).

Every key and channel starts with a **prefix**, `egradx:` by default (`egradx.redis.key-prefix`, `keyPrefix`,
`key_prefix`). Instances that must act together use the same prefix; applications sharing one Redis use different ones.

## Sign-in attempt limits

The same sliding window as the in-memory limiter, counted in Redis:

| Key | Type | Holds |
|---|---|---|
| `<prefix>auth:attempts:key:<key>\|<address>` | sorted set | one member per failure of `<key>` (`login:<identifier>` or `password:<user id>`) from `<address>` (`-` when there is none) |
| `<prefix>auth:attempts:address:<address>` | sorted set | one member per failure from `<address>`, whatever the key |

- A member is `<epoch ms>-<random>`, its score the epoch milliseconds of the failure.
- **Before reading**, members older than the window are removed (`ZREMRANGEBYSCORE key -inf <now - window>`).
- **A failure** adds a member, keeps only the newest `limit` (`ZREMRANGEBYRANK key 0 -(limit + 1)`), and sets the
  key to expire after the window (`PEXPIRE`).
- **The wait**, once a set holds `limit` members: the oldest member's score plus the window, minus now. With both sets
  at their limit, the longer wait.
- **A success** deletes the first key; the address's count stays.

The limits and window are the auth settings (`egradx.auth.rate-limit.*`), the same on every instance.

## Channels

Published with `PUBLISH`, as UTF-8 JSON. Every instance subscribes, its own messages included: an instance pushes its own notifications to its streams when its subscription hands them back. Until its subscription is in place (starting up, or Redis down at start), it pushes its own notifications to its streams directly, and only once even if the publish then fails.

| Channel | When | Every instance then |
|---|---|---|
| `<prefix>auth:role-authorities-changed` | a change to a role's authorities has committed | evicts that role from its role-authorities cache |
| `<prefix>notification:published` | an in-app notification has been stored and its transaction committed | pushes it to the live streams open on that instance that should see it |

The messages are in [`messages.json`](messages.json):

- **`role-authorities-changed`**: `{"roleId": "<uuid>"}`.
- **`notification-published`**: `{"item": <inbox item>, "recipientUserId": "<uuid>" | null}`. The item is the
  inbox item exactly as the notification API returns it (`contracts/openapi/notification.yaml`, `EgradxInboxItem`).
  `recipientUserId` is set for a notification to one user only.

A receiver ignores a field it does not know, and drops a message it cannot read, logging it.

## When Redis is unavailable

Nothing fails because Redis does. Each SDK logs the failure (at most once a minute per operation) and counts it
(`egradx.redis.failures`, tagged `operation`), and:

| | carries on as |
|---|---|
| attempt limits | not counted: sign-in is allowed, and failures are not recorded |
| role-authorities changes | each other instance's cache expires the entry within its TTL (60 s by default) |
| in-app notifications | pushed to this instance's live streams only; the others see them on their next load |

Subscriptions reconnect on their own.
