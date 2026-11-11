# Security Documentation

## Architecture Overview

WebDrop Pro uses a server-mediated, peer-to-peer architecture:

- **Browser** never talks to the database directly. All database access goes through Cloudflare Pages Functions.
- **Cloudflare Pages Functions** use the Neon serverless driver with the `DATABASE_URL` secret (never exposed to the browser).
- **Neon PostgreSQL** stores only session metadata, signaling messages, and temporary transfer history. No file contents.
- **WebRTC DataChannel** carries file contents directly between browsers, encrypted by DTLS.
- **TURN credentials** are served via `/api/turn-credentials` Function, never hardcoded in frontend.

## Security Measures Implemented

### 1. Credential Protection

- **DATABASE_URL**: stored as encrypted Cloudflare secret, never in frontend code
- **TURN_USERNAME / TURN_PASSWORD**: stored as encrypted Cloudflare secrets, served via Function
- **No secrets in GitHub**: `.gitignore` excludes `.dev.vars`, `.env`, `node_modules/`
- **No secrets in frontend bundle**: all sensitive operations are server-side

### 2. SQL Injection Prevention

- All database queries use the Neon serverless driver's tagged template literals: `sql\`SELECT ... WHERE code = ${code}\``
- Parameters are automatically escaped by the driver
- No string concatenation in SQL queries
- Input validation on every endpoint (session_code format, peer_id format, message_type enum)

### 3. Session Authorization

- Every signaling message write validates that:
  - The session exists and isn't expired
  - The `from_peer_id` is a participant in the session
  - The `to_peer_id` is also a participant
- Session join is atomic (SQL UPDATE with WHERE conditions) - prevents two receivers from joining
- Session codes are 12-char random (36^12 = 4.7 × 10^18 possible values) - not guessable

### 4. Input Validation

- `session_code`: validated as `[A-Z0-9]{12}` (12 uppercase alphanumeric)
- `peer_id`: validated as `[a-z0-9]{32}` (32 lowercase alphanumeric)
- `message_type`: validated against enum (`offer`, `answer`, `ice`)
- `direction`: validated against enum (`sent`, `received`)
- `payload`: max 32KB per signaling message
- `ids` array in consume: max 50 per request, each validated as UUID

### 5. Rate Limiting

- **Not yet implemented.** Cloudflare rate limiting bindings can be added to the Worker configuration if abuse is detected.
- The lazy cleanup mechanism prevents database bloat from abandoned sessions.
- Recommendation: add Cloudflare Rate Limiting rules if the service sees significant traffic.

### 6. CORS and Origin

- Permissive CORS (`Access-Control-Allow-Origin: *`) is used because the app is anonymous and cross-origin access doesn't grant any privileges.
- All sensitive operations require the DATABASE_URL secret which is only available server-side.
- Consider tightening CORS to specific origins if you add custom domains.

### 7. Security Headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`
- `Cache-Control: no-store` (prevents caching of API responses)

### 8. Error Handling

- Database errors return generic messages to the client (no stack traces, no internal details)
- Postbase/Neon connection errors return HTTP 503 with "Database temporarily unavailable"
- Console logs on the server contain error messages but NOT secrets or session payloads

### 9. File Integrity

- SHA-256 hash computed on sender side before transfer
- Hash included in `file-start` control message
- Receiver verifies hash after reassembly
- If hash mismatch: file is still offered for download but a prominent warning is shown ("File integrity check failed. The file may be corrupted.")

### 10. TURN Credential Protection

- TURN credentials stored as Cloudflare secrets (TURN_USERNAME, TURN_PASSWORD)
- Served to browser via `/api/turn-credentials` Function
- Credentials are static (not time-limited) in the current implementation
- **Future upgrade:** use Metered's ephemeral credential API with TURN_API_KEY + TURN_API_SECRET for time-limited credentials

### 11. Path Traversal Prevention (ZIP)

- `sanitizeZipPath()` in `zip.js` strips:
  - Drive prefixes (`C:\`, `/`)
  - `..` path segments
  - `.` path segments
- `dedupeName()` prevents duplicate entry collisions
- Receiver downloads ZIP as a file - never auto-extracts

### 12. Blob URL Cleanup

- Object URLs created for received files are revoked after 5 minutes
- Prevents memory leaks from accumulating blob references

### 13. Anonymous Session Security

- No user accounts = no personal data to protect
- Sessions expire after 15 minutes (signaling) or 24 hours (history)
- Session codes are random and not sequential (not enumerable)
- A valid peer_id is required for all signaling operations (not just the session code)

## Known Limitations

1. **No rate limiting**: a determined attacker could create many sessions. Mitigation: add Cloudflare Rate Limiting.
2. **Static TURN credentials**: if leaked, valid until manually rotated. Mitigation: upgrade to ephemeral credentials.
3. **No CSRF protection**: not needed because there are no authenticated sessions to protect.
4. **Polling-based signaling**: slightly higher latency than WebSocket. Not a security issue, just a performance trade-off.

## Security Audit Checklist

| Check | Status | Notes |
|---|---|---|
| No hardcoded credentials | Pass | All secrets in Cloudflare env |
| API key exposure | Pass | DATABASE_URL never in frontend |
| Database permissions | Pass | Single role, least privilege |
| Session authorization | Pass | Peer_id validated per request |
| Input validation | Pass | All endpoints validate inputs |
| CORS configuration | Pass | Permissive but safe (no auth to protect) |
| Rate limiting | Not implemented | Add if abuse detected |
| Session enumeration | Pass | 12-char random codes, not sequential |
| Expired sessions | Pass | 15-min/24-hour expiry + lazy cleanup |
| Secret leakage in logs | Pass | Errors logged without secrets |
| Unsafe API responses | Pass | Generic errors, no stack traces |
| SQL injection | Pass | Parameterized queries via Neon driver |
| Anonymous session abuse | Partial | No rate limit, but codes not guessable |
| Unauthorized transfer access | Pass | Peer_id required for all operations |
