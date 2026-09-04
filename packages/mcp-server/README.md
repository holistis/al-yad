# yad-agent-mcp

An MCP server that lets an AI agent drive [Yad](https://yadagent.com), a local, privacy-first browser-automation companion, in the user's real, already-logged-in browser.

This is a thin wrapper: it does not run a browser itself. It talks to Yad's existing local HTTP API on `127.0.0.1:3747` over stdio, so any MCP-compatible client (Claude Code, Cursor, Claude Desktop, etc.) can ask Yad to navigate, read a page, or carry out a plain-language browser task, and get the result back.

**Local-only by design.** This is not a hosted or remote MCP server. It only works on a machine that already has Yad installed and running (extension in Chrome/Edge/Brave, companion app active). If you're looking for a server your agent can call over the internet with zero local setup, this isn't that, and honestly, nothing that drives a user's real logged-in browser session should be.

## Requirements

- [Yad](https://yadagent.com) installed and running (Chrome, Edge, or Brave extension plus the local companion app)
- Node.js 20+

## Install

```bash
npm install -g yad-agent-mcp
```

## Configure your MCP client

Claude Code (`.mcp.json` or `claude mcp add`):

```json
{
  "mcpServers": {
    "yad-agent": {
      "command": "yad-agent-mcp"
    }
  }
}
```

If Yad's companion runs on a non-default port, set `YAD_COMPANION_URL` (defaults to `http://127.0.0.1:3747`).

## Tools

| Tool | What it does |
| --- | --- |
| `yad_status` | Checks whether Yad's companion is running and connected to the browser. Call this first. |
| `yad_navigate` | Opens a URL in the browser tab Yad controls. |
| `yad_capture` | Reads the URL, title, visible text, and links of the current page. |
| `yad_run_goal` | Gives Yad a plain-language task ("find the price of the first item", "click the login button") and waits for the result. |
| `yad_last_result` | Re-reads the result of the most recent `yad_run_goal` call. |

Yad cannot check out, pay, or place an order without the user's own confirmation, regardless of what an agent asks it to do. This wrapper doesn't add or remove that limit, it's enforced by Yad itself.

## Source

Part of the [al-yad](https://github.com/holistis/al-yad) monorepo. Issues and PRs welcome there.

## License

MIT
