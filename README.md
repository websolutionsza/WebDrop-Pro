# WebDrop Pro

Secure, anonymous, browser-based peer-to-peer file sharing. No accounts, no cloud storage, no file size limits. Files transfer directly between devices using WebRTC.

## Features

- **Two connection modes:** local network (direct host candidates) and cross-network (STUN + TURN fallback)
- **Anonymous:** no registration, no accounts, no personal data
- **Secure:** end-to-end encrypted WebRTC, SHA-256 file integrity verification
- **File types:** individual files, multiple files (with ZIP archive option), folders, text messages
- **QR pairing:** generate QR codes for transfer invitations, scan to join, or enter codes manually
- **Temporary history:** 24-hour transfer records, then automatic cleanup
- **Graceful degradation:** established transfers survive backend outages

## Architecture

```
[Browser A] <--WebRTC DataChannel (P2P or TURN)--> [Browser B]
     |                                              |
     +---- polling via Cloudflare Pages Functions --+
                       |
                [Neon PostgreSQL]
                 transfer_sessions
                 signaling_messages
                 transfer_history
```

- **Frontend:** vanilla HTML/CSS/JS (no framework), ES modules
- **Backend:** Cloudflare Pages Functions (server-side, talk to Neon)
- **Database:** Neon PostgreSQL (session metadata + temporary history only, no file contents)
- **Signaling:** polling-based (free tier, 1-second intervals)
- **TURN:** Metered (free 1 GB/month)

## Project Structure

```
WebDrop-Pro/
├── index.html              # Main application
├── terms.html              # Terms and Conditions
├── privacy.html            # Privacy Policy
├── 404.html                # Branded error page
├── google*.html            # Google Search Console verification
├── css/styles.css          # All styling
├── js/
│   ├── app.js              # Main UI orchestration
│   ├── webrtc.js           # RTCPeerConnection + DataChannel + chunking
│   ├── signaling.js        # Polling client for /api/signaling/*
│   ├── qr.js               # QR generation + scanning
│   └── zip.js              # Lazy-loaded JSZip wrapper
├── functions/
│   ├── _lib/
│   │   ├── db.js           # Neon connection helper
│   │   ├── response.js     # HTTP helpers + CORS + security headers
│   │   ├── auth.js         # Session validation
│   │   └── cleanup.js      # Lazy expired-row cleanup
│   └── api/
│       ├── session/        # create, join, status, complete
│       ├── signaling/      # message, poll, consume
│       ├── turn-credentials.js
│       └── history.js
├── migrations/
│   └── 001_create_tables.sql
├── .dev.vars.example       # Local dev secrets template
├── .env.example            # Environment variable documentation
├── .gitignore
└── package.json            # @neondatabase/serverless dependency
```

## Quick Start

1. **Database:** Create a Neon project, run `migrations/001_create_tables.sql` in the SQL Editor
2. **TURN:** Create a Metered account, get TURN credentials
3. **Cloudflare:** Set environment variables (see `DEPLOYMENT.md`)
4. **Deploy:** Push to GitHub, Cloudflare Pages auto-deploys

See `DEPLOYMENT.md` for detailed step-by-step instructions.

## Security

See `SECURITY.md` for the full security audit.

Key points:
- No credentials in frontend code
- All database access via Cloudflare Functions (server-side only)
- Parameterized SQL queries (SQL injection safe)
- Session validation on every API call
- TURN credentials served via Function, not hardcoded

## Testing

See `TESTING.md` for the full testing checklist.

## Credits

Developed by [WebSolutionsSA](https://websolutionsza.github.io/websolutionsSA/)

## License

All rights reserved.
