import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const projectPath = process.argv[2];
  const platformArg = process.argv[3];
  const configArg = process.argv[4];
  if (!projectPath) {
    console.error("Usage: node scripts/test-clean.mjs \u003cpath-to-.dproj-or-.groupproj\u003e [Win32|Win64] [Debug|Release]");
    process.exit(1);
  }

  const client = new Client(
    { name: "mcp-delphi-clean tester", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  const transport = new StdioClientTransport({
    command: "node",
    args: ["--env-file=.env", "dist/server.js"],
  });

  try {
    await client.connect(transport);
    const tools = await client.request({ method: "tools/list" },
      (await import("@modelcontextprotocol/sdk/types.js")).ListToolsResultSchema
    );
    const hasClean = tools.tools.some(t => t.name === "delphi.clean");
    if (!hasClean) {
      throw new Error("Server does not expose delphi.clean tool");
    }

    const result = await client.callTool({
      name: "delphi.clean",
      arguments: {
        project: projectPath,
        configuration: configArg || process.env.DELPHI_CONFIG || "Release",
        platform: platformArg || process.env.DELPHI_PLATFORM || "Win32"
      }
    });

    console.log("Tool call completed. isError=", result.isError);
    if (result.content?.length) {
      for (const part of result.content) {
        if (part.type === "text") {
          console.log(part.text);
        } else {
          console.log(JSON.stringify(part));
        }
      }
    }

    process.exit(result.isError ? 1 : 0);
  } catch (err) {
    console.error("Test clean failed:", err);
    process.exit(1);
  } finally {
    try { await client.close(); } catch {}
  }
}

main();

