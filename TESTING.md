# Testing Checklist

Mark each test with: [P]assed, [F]ailed, [N]ot tested, [R]equires external config

## Local Transfers

- [ ] Same Wi-Fi: two devices on same network, transfer a file
- [ ] Local QR: generate QR on device A, scan on device B, transfer
- [ ] Manual code entry: type 12-char code instead of scanning
- [ ] Local transfer while Neon unavailable: stop Neon, verify transfer still works (established connections survive)

## Cross-Network Transfers

- [ ] Different Wi-Fi: device A on home Wi-Fi, device B on different Wi-Fi
- [ ] Wi-Fi to mobile data: device A on Wi-Fi, device B on mobile data
- [ ] Mobile data to Wi-Fi: reverse of above
- [ ] Different geographical locations: two devices in different cities
- [ ] Direct WebRTC: verify connection type shows "Direct internet P2P"
- [ ] TURN-relayed: verify connection type shows "TURN-relayed connection"

## Transfer Functionality

- [ ] Single file: send one file, verify download on receiver
- [ ] Multiple files: select 2+ files, choose "Send individually"
- [ ] ZIP archive: select 2+ files, choose "Send as ZIP", verify receiver can unzip
- [ ] Folder: select a folder, verify structure preserved
- [ ] Text message: type text, click send, verify received
- [ ] TXT file: type text, click TXT button, verify received as .txt file
- [ ] Large file (>100MB): verify chunked transfer + progress bar
- [ ] File integrity: verify SHA-256 hash check passes on receiver
- [ ] Transfer cancellation: start a transfer, cancel it mid-way
- [ ] Interrupted connection: disconnect during transfer, verify error message

## QR Functionality

- [ ] QR generation: click "Send Files", verify QR appears
- [ ] QR scanning: open scanner, scan QR on another device
- [ ] Invalid QR: scan a non-WebDrop QR, verify error message
- [ ] Expired invitation: wait 15+ minutes, try to join, verify expired error
- [ ] Manual joining: type code manually, verify join works

## Backend and Security

- [ ] Neon connection: verify /api/session/create returns ok
- [ ] Neon scale-to-zero: wait 5+ minutes, verify wake-up on next request
- [ ] Neon quota exhaustion: [R] simulate by using up compute hours
- [ ] Recovery: after Neon outage ends, verify app recovers
- [ ] Cleanup: create sessions, wait for expiry, verify rows deleted
- [ ] Cloudflare secrets: verify no secrets appear in frontend bundle
- [ ] SQL injection: try malicious input in code field, verify rejected
- [ ] Session enumeration: try random codes, verify all fail

## Browser Compatibility

- [ ] iPhone Safari: [R] requires iOS device
- [ ] Android Chrome: [R] requires Android device
- [ ] Desktop Chrome
- [ ] Desktop Firefox
- [ ] Desktop Edge

## Connection Status Indicators

- [ ] "Connecting..." shown during handshake
- [ ] "Local network connection" shown for same-Wi-Fi
- [ ] "Direct internet P2P" shown for cross-network direct
- [ ] "TURN-relayed connection" shown when TURN is used
- [ ] "Disconnected" shown on close
- [ ] "Connection failed" shown on failure
- [ ] "Backend temporarily unavailable" shown when Neon is down

## How to Perform Cross-Network Tests

### Two devices on different networks

1. Device A: home Wi-Fi
2. Device B: mobile data (turn off Wi-Fi)
3. On device A: open WebDrop Pro, click "Send Files"
4. On device B: open WebDrop Pro, scan the QR code
5. Transfer should establish within 5-10 seconds
6. Check the connection type indicator

### Two devices in different locations

1. Ask a friend in another city to help
2. One of you clicks "Send Files", shares the QR via photo or screen share
3. The other enters the code manually or scans
4. Transfer should work if TURN is configured

### Do NOT simulate cross-network with two browser tabs

Two tabs on the same browser share the same network. This tests local-network transfer, not cross-network. For real cross-network testing, you need two devices on different networks.

## Test Result Summary

| Category | Tested | Passed | Failed | Not Tested |
|---|---|---|---|---|
| Local | | | | |
| Cross-network | | | | |
| Transfer | | | | |
| QR | | | | |
| Backend | | | | |
| Browser | | | | |
| Status | | | | |
