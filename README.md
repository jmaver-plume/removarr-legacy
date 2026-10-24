# Removarr

A voting-based media removal system that integrates with Sonarr/Radarr to automatically delete content once all users approve.

## Quick Start

### First-time Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start the application**
   ```bash
   npm start
   ```
   
   That's it! On first startup, the application will:
   - Create the database and settings table
   - Generate admin credentials (username: `removarr`, random password)
   - Display the generated password in the console
   
   **Save the generated password!** You'll need it to login.

3. **Complete configuration**
   
   Login with the generated credentials, then configure via:
   
   Option A - Interactive CLI:
   ```bash
   npm run configure
   ```
   
   Option B - Via API after login:
   ```bash
   curl -X PUT http://localhost:3000/removarr/api/settings \
     -H "Content-Type: application/json" \
     -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
     -d '{
       "sonarr_url": "http://localhost:8989",
       "sonarr_api_key": "your-key",
       "radarr_url": "http://localhost:7878",
       "radarr_api_key": "your-key",
       "voters": ["Alice", "Bob"]
     }'
   ```

## Configuration

All configuration is stored in the database. No environment variables are required (though you can optionally set them).

### Optional Environment Variables (.env)
- `SESSION_SECRET` - Session secret (auto-generated if not provided)
- `PORT` - Server port (default: 3000)
- `DB_PATH` - Database file path (default: ./database.sqlite)

### Application Settings (Database)
Settings are auto-initialized on first startup and can be managed via:
- Interactive CLI: `npm run configure`
- API endpoints: See [docs/SETTINGS.md](docs/SETTINGS.md)

Settings include:
- Admin credentials (auto-generated on first startup)
- Sonarr URL and API key
- Radarr URL and API key
- Voter list

### Webhook Integration

For Removarr to work properly and display download status, you need to configure webhooks in both Sonarr and Radarr.

#### Radarr Webhook Setup
1. Go to **Settings → Connect → Add → Webhook**
2. Configure:
   - **Name**: Removarr Webhook
   - **Webhook URL**: `http://your-removarr-host:3000/removarr/webhook/radarr`
   - **Method**: POST
3. Enable the following **Notification Triggers**:
   - ✅ **On Import** (or "On File Import") - Required for download status
   - ✅ **On Movie Added** - Adds new movies to Removarr
   - ✅ **On Movie Delete** - Removes deleted movies from Removarr

#### Sonarr Webhook Setup
1. Go to **Settings → Connect → Add → Webhook**
2. Configure:
   - **Name**: Removarr Webhook
   - **Webhook URL**: `http://your-removarr-host:3000/removarr/webhook/sonarr`
   - **Method**: POST
3. Enable the following **Notification Triggers**:
   - ✅ **On Import Complete** - Required for download status
   - ✅ **On Series Add** - Adds new series to Removarr
   - ✅ **On Series Delete** - Removes deleted series from Removarr

**Note**: The download status indicator (green/red bar) will show:
- **Green**: Media is fully downloaded
- **Red**: Media is not yet downloaded or partially downloaded

For ongoing TV series, the status shows green when all currently aired episodes are downloaded, not when the entire series has finished airing.

## Running Locally

```bash
npm run dev
```

## Deployment

### Remote Server Setup

1. Copy changes to remote server:
   ```bash
   rsync -av --exclude-from='.gitignore' ./ mediacenter:~/removarr
   ```

2. Rebuild the Docker container:
   ```bash
   sudo docker compose up -d --no-deps --build removarr
   ```

### Docker Notes

Make sure your Docker setup:
- Mounts the database file persistently (e.g., `/app/data`)
- Exposes the configured port
- On first run, check logs for the generated admin password

## API Documentation

See [docs/SETTINGS.md](docs/SETTINGS.md) for:
- Settings API endpoints
- Configuration management
- Migration guides
- Troubleshooting

### Private GitHub Container Registry

Every push to `main` builds the production Docker image and publishes it to
`ghcr.io/jmaver-plume/removarr-legacy` with `latest` and `sha-<full-commit-sha>` tags.
You can also run **Publish container image** manually in GitHub Actions.
The workflow uses GitHub's automatic `GITHUB_TOKEN`; no registry secret is needed.
New GHCR packages are private by default. Keep the package visibility **Private**
in GitHub package settings. If the package already exists, grant this repository
write access under the package's **Manage Actions access** settings.

On your Docker host, authenticate with a GitHub personal access token (classic)
with `read:packages` permission (and organization SSO authorization if required):

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
docker pull ghcr.io/jmaver-plume/removarr-legacy:latest
docker run -d --name removarr --restart unless-stopped \
  -p 3000:3000 \
  -v removarr-data:/app/data \
  ghcr.io/jmaver-plume/removarr-legacy:latest
```

Open `http://localhost:3000/removarr` and check `docker logs removarr` for the
initial admin password. The image includes Node.js, production dependencies,
and application assets. Configuration and SQLite data are initialized on first
startup and persisted in the volume; local databases and environment secrets
are excluded from the image. Published images target Linux AMD64.
