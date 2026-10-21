# Redbooth MCP – Stateless OAuth Broker (Cloudflare Worker)

This tiny, stateless Cloudflare Worker holds the single Redbooth OAuth app credentials (`REDBOOTH_CLIENT_ID` and `REDBOOTH_CLIENT_SECRET`) so end users can install `redbooth-mcp` in **one click** without registering their own developer app on Redbooth.

- **Zero storage:** No database, no KV, no logs of tokens.
- **Direct API calls:** The Worker only handles `/authorize`, `/callback`, and `/token`. All Redbooth API traffic (`/api/3/*`) goes directly from the user's machine to `https://redbooth.com`.

## Deploy in 2 minutes (Free Cloudflare Tier)

1. Register a single Redbooth OAuth app at **https://redbooth.com/oauth2/applications**:
   - **Name:** `Redbooth MCP`
   - **Redirect URI:** `https://redbooth-mcp-auth.<your-subdomain>.workers.dev/callback`
2. Deploy the Worker and store the secrets:
   ```bash
   cd worker
   npx wrangler deploy
   npx wrangler secret put REDBOOTH_CLIENT_ID
   npx wrangler secret put REDBOOTH_CLIENT_SECRET
   ```
3. If your Worker URL differs from the default `DEFAULT_BROKER_URL` in `src/auth.ts`, update `DEFAULT_BROKER_URL` in `src/auth.ts` before publishing a release.
