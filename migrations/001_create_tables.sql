-- ==========================================================================
-- WebDrop Pro - Initial schema migration
-- Database: Neon PostgreSQL
-- Purpose: Temporary session coordination and signaling for anonymous
--          peer-to-peer file transfers. No file contents are ever stored.
--
-- To apply: paste this entire file into the Neon SQL Editor and click Run.
-- Safe to re-run: the DROP statements at the top clean up any prior version.
-- ==========================================================================

-- Clean slate (safe to re-run during development)
DROP TABLE IF EXISTS transfer_history CASCADE;
DROP TABLE IF EXISTS signaling_messages CASCADE;
DROP TABLE IF EXISTS transfer_sessions CASCADE;

-- --------------------------------------------------------------------------
-- Table 1: transfer_sessions
-- One row per transfer invitation. Sender creates it; receiver looks it up
-- by session_code (the short code shown in the QR / typed manually).
----------------------------------------------------------------------------
CREATE TABLE transfer_sessions (
    session_code      TEXT PRIMARY KEY,                       -- 12-char alphanumeric (A-Z, 0-9)
    status            TEXT NOT NULL DEFAULT 'waiting'
                      CHECK (status IN ('waiting','joining','connected','completed','expired','cancelled')),
    creator_peer_id   TEXT NOT NULL,                           -- 32-char random (a-z, 0-9)
    joiner_peer_id    TEXT,                                    -- set when receiver joins
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ NOT NULL,                    -- created_at + 15 minutes
    completed_at      TIMESTAMPTZ,                             -- set on successful completion
    transfer_summary  TEXT                                     -- "3 files, 12.4 MB" - filled on completion
);

CREATE INDEX idx_sessions_expires ON transfer_sessions(expires_at);
CREATE INDEX idx_sessions_status  ON transfer_sessions(status);

-- --------------------------------------------------------------------------
-- Table 2: signaling_messages
-- Transient WebRTC signaling messages (SDP offers, SDP answers, ICE
-- candidates). Each message is one row. Consumed messages are soft-deleted
-- (consumed = TRUE) and cleaned up lazily.
----------------------------------------------------------------------------
CREATE TABLE signaling_messages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code  TEXT NOT NULL REFERENCES transfer_sessions(session_code) ON DELETE CASCADE,
    from_peer_id  TEXT NOT NULL,
    to_peer_id    TEXT NOT NULL,
    message_type  TEXT NOT NULL
                  CHECK (message_type IN ('offer','answer','ice')),
    payload       TEXT NOT NULL,                               -- SDP or ICE candidate JSON (max 32KB)
    consumed      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL                         -- created_at + 5 minutes
);

CREATE INDEX idx_signaling_target  ON signaling_messages(to_peer_id, consumed);
CREATE INDEX idx_signaling_session ON signaling_messages(session_code);
CREATE INDEX idx_signaling_expires ON signaling_messages(expires_at);

-- --------------------------------------------------------------------------
-- Table 3: transfer_history
-- Completed transfer metadata only. No file contents. Retained 24 hours
-- for the temporary history feature, then deleted by lazy cleanup.
-- Includes peer_id so a browser can query its own recent transfers.
----------------------------------------------------------------------------
CREATE TABLE transfer_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code  TEXT NOT NULL REFERENCES transfer_sessions(session_code) ON DELETE CASCADE,
    peer_id       TEXT NOT NULL,                               -- the local user's peer_id
    direction     TEXT NOT NULL
                  CHECK (direction IN ('sent','received')),
    peer_label    TEXT NOT NULL,                               -- display label for the other party
    file_count    INTEGER NOT NULL,
    total_bytes   BIGINT NOT NULL,
    file_names    JSONB NOT NULL,                              -- array of {name, size, hash}
    completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL                         -- completed_at + 24 hours
);

CREATE INDEX idx_history_peer    ON transfer_history(peer_id, expires_at DESC);
CREATE INDEX idx_history_expires ON transfer_history(expires_at);
CREATE INDEX idx_history_session ON transfer_history(session_code);

-- ==========================================================================
-- End of migration
-- ==========================================================================
