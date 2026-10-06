-- egradx-auth: refresh tokens are kept as a SHA-256 of the token, never as the token, so a copy of the
-- database (a backup, a read replica, a leaked dump) cannot be turned into working sessions. Clients
-- keep presenting the token they hold; the libraries hash it to find its row. Lowercase hex of the
-- SHA-256 of the token's UTF-8 bytes (contracts/test-vectors/refresh-token.json): the tokens issued
-- before this migration are converted in place, so every session survives it.

ALTER TABLE egradx_refresh_token RENAME COLUMN token TO token_hash;
UPDATE egradx_refresh_token SET token_hash = encode(sha256(convert_to(token_hash, 'UTF8')), 'hex');
ALTER TABLE egradx_refresh_token ALTER COLUMN token_hash TYPE VARCHAR(64);
