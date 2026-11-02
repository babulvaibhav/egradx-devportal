-- egradx-auth: sessions. A session is one sign-in on one device: it starts at sign-in, lives through every refresh,
-- and ends by signing out, switching organization, being ended from another device, signing out everywhere, or a
-- refresh token being presented again after it was replaced. Refresh tokens rotate: each refresh replaces the token
-- presented (rotated_at) with a new one in the same session. An access token's sid is its session's id, so ending a
-- session refuses its access tokens on their next request.
--
-- Each refresh token issued before this migration becomes a session of its own, with its id, so every session
-- survives it. Access tokens issued before it carry a sid that is no session: they are refused, and the client
-- refreshes once.

CREATE TABLE egradx_session (
    id              UUID PRIMARY KEY,
    user_id         UUID         NOT NULL,
    organization_id UUID,
    created_at      TIMESTAMP(6) NOT NULL,
    last_used_at    TIMESTAMP(6) NOT NULL,
    -- When the session's refresh tokens stop working, however often they rotate: sign-in plus the refresh-token
    -- lifetime. Rotation never extends it.
    expires_at      TIMESTAMP(6) NOT NULL,
    ended_at        TIMESTAMP(6),
    -- SIGNED_OUT, SWITCHED, ENDED (from the sessions list), ALL_ENDED (password, reset, everywhere), REUSED
    end_reason      VARCHAR(32),
    user_agent      VARCHAR(512),
    ip_address      VARCHAR(64)
);
CREATE INDEX idx_egradx_session_user_id ON egradx_session(user_id);
CREATE INDEX idx_egradx_session_expires_at ON egradx_session(expires_at);

INSERT INTO egradx_session (id, user_id, organization_id, created_at, last_used_at, expires_at, ended_at, end_reason)
SELECT id, user_id, organization_id, created_at, created_at, expiry_date, revoked_at,
       CASE WHEN revoked_at IS NULL THEN NULL ELSE 'SIGNED_OUT' END
FROM egradx_refresh_token;

ALTER TABLE egradx_refresh_token ADD COLUMN session_id UUID;
ALTER TABLE egradx_refresh_token ADD COLUMN rotated_at TIMESTAMP(6);
UPDATE egradx_refresh_token SET session_id = id;
ALTER TABLE egradx_refresh_token ALTER COLUMN session_id SET NOT NULL;
ALTER TABLE egradx_refresh_token ADD CONSTRAINT fk_egradx_refresh_token_session
    FOREIGN KEY (session_id) REFERENCES egradx_session(id) ON DELETE CASCADE;
CREATE INDEX idx_egradx_refresh_token_session_id ON egradx_refresh_token(session_id);
