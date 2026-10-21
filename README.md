# Redbooth for Claude (MCP Server)

Connect [Redbooth](https://redbooth.com) to **Claude Desktop**, **Claude Code**, **Cursor**, **Antigravity**, and other MCP clients in **one click**—no API keys or developer setup needed.

> *"What's overdue in the Website project?"* · *"Create a task for Anna to review the Q3 deck by Friday"* · *"Summarize the comments on task 12345 and mark it done"*

---

## Quick Install

### Option A: Claude Desktop (1-Click Extension)

1. [**Download `redbooth.mcpb`**](https://github.com/rmstougaard/redbooth-mcp/releases/latest/download/redbooth.mcpb) from the latest release.
2. Double-click `redbooth.mcpb` (or drag it into **Claude Desktop → Settings → Extensions**) and click **Install**.
3. Ask Claude anything about your Redbooth workspace (e.g. *"List my Redbooth projects"*).
4. On your first question, your browser will automatically open to Redbooth—click **Allow** and you're connected!

---

### Option B: Claude Code (1 Command)

```bash
claude mcp add redbooth -- npx -y redbooth-mcp
```

---

### Option C: Cursor / Antigravity / Claude Desktop JSON

Add this to your MCP settings (`claude_desktop_config.json`, `.cursor/mcp.json`, or Antigravity MCP settings):

```json
{
  "mcpServers": {
    "redbooth": {
      "command": "npx",
      "args": ["-y", "redbooth-mcp"]
    }
  }
}
```

---

## How Sign-In & Privacy Work

- **Automatic browser sign-in:** The first time you ask your assistant to read or update Redbooth, it opens your default browser to Redbooth's official OAuth screen. Click **Allow**, and your tokens are saved locally in `~/.config/redbooth-mcp/tokens.json` (permissions `0600`) and refreshed automatically.
- **Direct connection:** A tiny, stateless Cloudflare Worker (`worker/`) handles only the initial OAuth handshake so you don't have to register your own Redbooth developer app. It stores zero data. All your projects, tasks, and comments flow **directly between your computer and `https://redbooth.com`**.
- **Switch accounts anytime:** Ask Claude to *"log out of Redbooth"* or run `npx -y redbooth-mcp logout`.

---

## Available Tools (21)

| Tool | Description | Writes? |
|---|---|:-:|
| `login` / `logout` | Connect or disconnect your Redbooth account in the browser | |
| `get_me` | Current user profile | |
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

> **Read-only mode:** Enable the **Read-only mode** toggle in Claude Desktop's extension settings (or set `REDBOOTH_READ_ONLY=true`) to disable all ✏️ tools. Delete tools are intentionally excluded.

---

## Advanced: Self-Hosting / Custom OAuth App

If you prefer not to use the default stateless OAuth broker, you can either deploy your own Cloudflare Worker (see [`worker/README.md`](./worker/README.md)) or register a personal Redbooth app at `https://redbooth.com/oauth2/applications` (Redirect URI `http://localhost:8765/callback`):

| Variable | Purpose |
|---|---|
| `REDBOOTH_READ_ONLY=true` | Disable all write tools |
| `REDBOOTH_AUTH_BROKER_URL` | Point to your own Cloudflare Worker OAuth broker |
| `REDBOOTH_CLIENT_ID` / `REDBOOTH_CLIENT_SECRET` | Use your own Redbooth OAuth app directly (bypasses the broker) |
| `REDBOOTH_ACCESS_TOKEN` | Use a static access token |
| `REDBOOTH_TOKEN_PATH` | Custom token file location (default `~/.config/redbooth-mcp/tokens.json`) |

## Development

```bash
git clone https://github.com/rmstougaard/redbooth-mcp.git && cd redbooth-mcp
npm install
npm run build
npm test
npm run inspect   # opens the MCP Inspector against the local build
```

## License

MIT. This is an unofficial project and is not affiliated with Redbooth.
