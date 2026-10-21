# Redbooth MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server for [Redbooth](https://redbooth.com). It lets Claude and other AI assistants read and manage your Redbooth projects, tasks, subtasks and comments.

> "What's overdue in the Website project?" · "Create a task for Anna to review the Q3 deck by Friday" · "Summarize the comments on task 12345 and mark it done"

Works with **Claude Desktop**, **Claude Code**, **Cursor**, **Antigravity**, **VS Code** and any other MCP client that supports local (stdio) servers.

---

## 1. Create a Redbooth OAuth app (one-time, ~2 min)

Redbooth only supports OAuth2 and has no personal API keys, so each user registers their own (free) app:

1. Go to **https://redbooth.com/oauth2/applications** and create a new application.
2. Set the **Redirect URI** to exactly:
   ```
   http://localhost:8765/callback
   ```
3. Copy the **Client ID** and **Client Secret**.

Your credentials and tokens stay on your machine. This server talks only to `redbooth.com`.

## 2. Install in your AI assistant

### Option A: Claude Desktop extension (easiest)

1. Download `redbooth.mcpb` from the [latest release](https://github.com/rmstougaard/redbooth-mcp/releases/latest).
2. Double-click it, or drag it into **Claude Desktop → Settings → Extensions**.
3. Enter your Client ID and Client Secret when prompted.
4. In a chat, ask Claude to *"log in to Redbooth"*. Your browser opens; click **Allow**. Done.

### Option B: Claude Code

```bash
claude mcp add redbooth \
  -e REDBOOTH_CLIENT_ID=your_id \
  -e REDBOOTH_CLIENT_SECRET=your_secret \
  -- npx -y redbooth-mcp
```

### Option C: Claude Desktop / Cursor / Antigravity (JSON config)

Add this to your client's MCP config. For Claude Desktop that's `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "redbooth": {
      "command": "npx",
      "args": ["-y", "redbooth-mcp"],
      "env": {
        "REDBOOTH_CLIENT_ID": "your_id",
        "REDBOOTH_CLIENT_SECRET": "your_secret"
      }
    }
  }
}
```

Restart the client.

## 3. Log in

Either:

- **In chat:** ask the assistant to *"log in to Redbooth"* (it calls the `login` tool), **or**
- **In a terminal:**
  ```bash
  REDBOOTH_CLIENT_ID=your_id REDBOOTH_CLIENT_SECRET=your_secret npx -y redbooth-mcp auth
  ```

Tokens are stored in `~/.config/redbooth-mcp/tokens.json` (permissions `600`) and refreshed automatically. Check status with `npx -y redbooth-mcp status`.

---

## Tools

| Tool | Description | Writes? |
|---|---|:-:|
| `login` | Connect to Redbooth (opens browser) | |
| `get_me` | Current user | |
| `list_organizations` | Your organizations | |
| `list_users` | Users (filter by org or project), to find assignee IDs | |
| `list_projects` / `get_project` | Projects | |
| `create_project` | Create a project | ✏️ |
| `list_task_lists` | Task lists in a project | |
| `create_task_list` | Create a task list | ✏️ |
| `list_tasks` | Filter by project, list, assignee, status | |
| `get_task` | Task details | |
| `create_task` | Create a task (name, description, assignee, due date, urgent) | ✏️ |
| `update_task` | Change any task field, or move it to another list | ✏️ |
| `complete_task` | Mark a task resolved | ✏️ |
| `list_subtasks` / `create_subtask` / `update_subtask` | Checklist items | ✏️ (create/update) |
| `list_comments` / `add_comment` | Task comments | ✏️ (add) |
| `redbooth_api_get` | Read-only escape hatch for any API v3 GET path | |

There are no delete tools, on purpose. Set `REDBOOTH_READ_ONLY=true` to hide every ✏️ tool.

## Configuration

| Variable | Purpose |
|---|---|
| `REDBOOTH_CLIENT_ID` / `REDBOOTH_CLIENT_SECRET` | OAuth app credentials (needed for login and refresh) |
| `REDBOOTH_READ_ONLY` | `true` disables all write tools |
| `REDBOOTH_ACCESS_TOKEN` | Use a static token instead of the OAuth flow (expires, so best for quick tests) |
| `REDBOOTH_TOKEN_PATH` | Custom token file location |
| `REDBOOTH_REDIRECT_PORT` | Callback port (default `8765`; update your app's redirect URI to match) |

## FAQ

**Does this work on claude.ai in the browser?**
Not yet. claude.ai web and mobile only support *remote* MCP servers (hosted at a URL). This project is a *local* server that runs on your computer. A hosted version is on the roadmap.

**Is my data sent anywhere else?**
No. The server runs locally and only calls `https://redbooth.com`.

---

## Development

```bash
git clone https://github.com/rmstougaard/redbooth-mcp.git && cd redbooth-mcp
npm install
npm run build
npm test
npm run inspect   # opens the MCP Inspector against the local build
```

Project layout:

```
src/
  cli.ts            # entry: serve | auth | status
  index.ts          # MCP server + tool registration
  auth.ts           # token storage & refresh
  login.ts          # OAuth authorization-code flow (local callback server)
  client.ts         # Redbooth REST client (retries, pagination)
  tools/            # tool definitions
manifest.json       # Claude Desktop extension (MCPB) manifest
```

### Releasing

1. Bump `version` in `package.json`, `manifest.json` and `src/index.ts`.
2. `git tag v0.x.y && git push --tags`
3. GitHub Actions publishes to npm (needs the `NPM_TOKEN` secret) and attaches `redbooth.mcpb` to the release.

## License

MIT. This is an unofficial project and is not affiliated with Redbooth.
