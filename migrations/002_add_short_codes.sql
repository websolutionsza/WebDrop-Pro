-- ==========================================================================
-- WebDrop Pro - Migration 002: Add 4-digit short codes for Easy P2P mode
--
-- This migration is ADDITIVE and SAFE. It does not alter any existing column
-- or remove any existing data. It adds:
--   1. A nullable `short_code CHAR(4)` column to `transfer_sessions`.
--      Only Easy P2P sessions have a short_code; Cross-Network sessions
--      leave it NULL. The existing `session_code` (12-char) remains the
--      primary key and is used for all signaling.
--   2. A `pairing_attempts` table for rate-limiting short-code lookups
--      (brute-force protection, since a 4-digit code has only 10,000
--      possibilities).
--
-- To apply: paste this entire file into the Neon SQL Editor and click Run.
-- Safe to re-run: all statements use IF NOT EXISTS.
-- ==========================================================================

-- 1. Add short_code column to transfer_sessions
ALTER TABLE transfer_sessions
  ADD COLUMN IF NOT EXISTS short_code CHAR(4);

-- Index for fast lookup of sessions by short_code.
-- Only non-NULL rows are indexed (partial index) to keep it small.
CREATE INDEX IF NOT EXISTS idx_sessions_short_code
  ON transfer_sessions(short_code)
  WHERE short_code IS NOT NULL;

-- 2. Rate-limiting table for short-code pairing attempts.
--    Each row = one attempt to look up a short code from a given IP.
--    We count attempts per IP in a sliding window (default 5 min) and
--    reject with 429 if the limit is exceeded.
CREATE TABLE IF NOT EXISTS pairing_attempts (
    id            BIGSERIAL PRIMARY KEY,
    source_ip    TEXT NOT NULL,
    short_code   CHAR(4),
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pairing_attempts_ip
  ON pairing_attempts(source_ip, attempted_at);

CREATE INDEX IF NOT EXISTS idx_pairing_attempts_cleanup
  ON pairing_attempts(attempted_at);

-- ==========================================================================
-- End of migration 002
-- ==========================================================================
