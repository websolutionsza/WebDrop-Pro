# Deployment Guide

This guide walks you through deploying WebDrop Pro from scratch.

## Prerequisites

- A GitHub account
- A Cloudflare account (free)
- A Neon account (free)
- A Metered account (free)

## Step 1: Neon Database Setup

### 1.1 Create a Neon project

1. Go to https://console.neon.tech/
2. Sign up / sign in
3. Click **New Project**
4. Name: `WebDrop Pro`
5. Database name: `webdrop`
6. Region: closest to your users
7. Click **Create Project**
8. Save the **pooled connection string** (contains `-pooler-` in hostname)

### 1.2 Create the database tables

1. In the Neon dashboard, open **SQL Editor**
2. Open the file `migrations/001_create_tables.sql` from this repo
3. Copy the entire contents, paste into the SQL Editor
4. Click **Run**
5. Verify 3 tables were created: `transfer_sessions`, `signaling_messages`, `transfer_history`

## Step 2: Metered TURN Setup

### 2.1 Create a Metered account

1. Go to https://www.metered.ca/stuff/turn-server
2. Sign up
3. Create a new app (name: `webdrop-pro`, framework: Other)
4. Note your App ID

### 2.2 Get TURN credentials

1. In the Metered dashboard, find the TURN section
2. Your TURN username and password are displayed there
3. Save both values securely

## Step 3: Cloudflare Pages Configuration

### 3.1 Connect your GitHub repo

1. Go to https://dash.cloudflare.com/
2. **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. Select your `WebDrop-Pro` GitHub repository
4. Build settings:
   - Framework preset: **None**
   - Build command: `npm install` (or leave empty if no build needed)
   - Build output directory: `/` (root)
5. Click **Save and Deploy**

### 3.2 Add environment variables

1. Go to your Pages project → **Settings** → **Environment variables**
2. Select **Production** environment
3. Add these **encrypted secrets**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon pooled connection string |
| `TURN_USERNAME` | Your Metered TURN username |
| `TURN_PASSWORD` | Your Metered TURN password |

4. Add these **plain text** variables:

| Variable | Value |
|---|---|
| `PUBLIC_BASE_URL` | `https://your-project.pages.dev` |
| `TURN_PROVIDER` | `metered-static` |

### 3.3 Trigger a redeploy

Environment variables are only picked up on the next deploy. Go to **Deployments** → most recent → **⋯** → **Retry deployment**.

## Step 4: Verify the deployment

1. Visit your `*.pages.dev` URL
2. The page should load with the WebDrop Pro interface
3. Click **Send Files** → a QR code should appear
4. Open the URL on a second device → scan the QR or enter the code
5. The two devices should connect

## Local Development

### Prerequisites

- Node.js 18+
- Wrangler CLI: `npm install -g wrangler`

### Setup

1. Clone the repo
2. `npm install` (installs @neondatabase/serverless)
3. Copy `.dev.vars.example` to `.dev.vars`
4. Fill in your real Neon + TURN credentials in `.dev.vars`
5. Run: `wrangler pages dev . --compatibility-date=2024-01-01`
6. Open http://localhost:8788

## Troubleshooting

### "Database temporarily unavailable"

- Check that `DATABASE_URL` is set correctly in Cloudflare
- Check that the Neon database hasn't exhausted its compute hours
- Neon scales to zero after 5 minutes of inactivity - first request takes ~1s longer

### QR scanner doesn't open

- HTTPS is required for camera access
- On localhost, use `wrangler pages dev` which provides HTTPS
- Check browser camera permissions

### Cross-network transfers fail

- Verify TURN credentials are set in Cloudflare
- Check that `TURN_PROVIDER` is `metered-static`
- The TURN free tier has 1 GB/month limit - if exhausted, cross-network behind strict NAT will fail
- Try same-network transfer first to verify WebRTC works

### Functions return 404

- Ensure `functions/` directory is at the repo root
- Ensure `package.json` has `@neondatabase/serverless` as a dependency
- Check Cloudflare Pages build logs for npm install errors
