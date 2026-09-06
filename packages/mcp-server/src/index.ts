#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import * as companion from "./companion-client.js";

const server = new McpServer({
  name: "yad-agent",
  version: "0.1.0",
});

function textResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function errorResult(e: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
}

server.registerTool(
  "yad_status",
  {
    title: "Yad status",
    description:
      "Check whether the Yad browser companion is running and connected to Chrome/Edge/Brave on this machine. Call this first before any other yad_* tool.",
    inputSchema: {},
  },
  async () => {
    try {
      return textResult(await companion.status());
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "yad_navigate",
  {
    title: "Navigate browser",
    description: "Open a URL in the user's real, already-logged-in browser tab that Yad controls.",
    inputSchema: {
      url: z.string().url().describe("Full http:// or https:// URL to navigate to"),
    },
  },
  async ({ url }) => {
    try {
      return textResult(await companion.navigate(url));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "yad_capture",
  {
    title: "Read current page",
    description: "Read the URL, title, visible text and links of whatever page is currently open in the browser tab Yad controls.",
    inputSchema: {},
  },
  async () => {
    try {
      return textResult(await companion.capture());
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "yad_run_goal",
  {
    title: "Run a browser task",
    description:
      "Give Yad a plain-language task to carry out in the user's real, logged-in browser (e.g. 'find the price of the first item on this page' or 'click the login button'). Waits for the task to finish and returns the result. Yad cannot check out, pay, or place orders without the user's direct confirmation.",
    inputSchema: {
      goal: z.string().min(1).max(1000).describe("Plain-language description of what to do in the browser"),
      url: z.string().url().optional().describe("Optional URL to navigate to before starting the task"),
      maxSteps: z.number().int().min(1).max(50).optional().describe("Optional cap on how many browser actions Yad may take"),
    },
  },
  async ({ goal, url, maxSteps }) => {
    try {
      return textResult(await companion.runGoal(goal, { url, maxSteps }));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "yad_last_result",
  {
    title: "Last task result",
    description: "Fetch the result of the most recent yad_run_goal call, in case it needs to be re-read.",
    inputSchema: {},
  },
  async () => {
    try {
      return textResult(await companion.lastResult());
    } catch (e) {
      return errorResult(e);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("yad-agent-mcp failed to start:", e);
  process.exit(1);
});
