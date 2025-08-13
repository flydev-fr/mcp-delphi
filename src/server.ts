import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { basename, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Utility: run a command and capture output
function runCommand(cmd: string, args: string[], options: { cwd?: string, env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ code: number | null, stdout: string, stderr: string }>((resolvePromise) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: true, // allow .bat files
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

// Tool input schema shapes (for registerTool)
const BuildInput = {
  project: z.string().describe('Path to a Delphi .dproj or .groupproj file'),
  configuration: z.string().optional().default(process.env.DELPHI_CONFIG || 'Release'),
  platform: z.string().optional().default(process.env.DELPHI_PLATFORM || 'Win32'),
  msbuildPath: z.string().optional().describe('Optional path to msbuild.exe to use'),
  rsvarsPath: z.string().optional().describe('Optional path to rsvars.bat to initialize RAD Studio env')
};

const CleanInput = {
  project: z.string().describe('Path to a Delphi .dproj or .groupproj file'),
  configuration: z.string().optional(),
  platform: z.string().optional().default(process.env.DELPHI_PLATFORM || 'Win32'),
  msbuildPath: z.string().optional(),
  rsvarsPath: z.string().optional()
};

function resolveDefaults() {
  const rsvars = process.env.RSVARS_BAT || process.env.RSVARS_PATH;
  const msbuild = process.env.MSBUILD_PATH;
  return { rsvars, msbuild };
}

function isDelphiProject(file: string) {
  const ext = extname(file).toLowerCase();
  return ext === '.dproj' || ext === '.groupproj';
}

async function buildWithMSBuild({ project, configuration, platform, msbuildPath, rsvarsPath }: { project: string; configuration?: string; platform?: string; msbuildPath?: string; rsvarsPath?: string; }) {
  const projPath = resolve(project);
  if (!existsSync(projPath)) {
    throw new Error(`Project not found: ${projPath}`);
  }
  if (!isDelphiProject(projPath)) {
    throw new Error('Unsupported project type. Provide a .dproj or .groupproj file');
  }

  const { rsvars, msbuild } = resolveDefaults();
  const rsvarsFinal = rsvarsPath || rsvars;
  const msbuildFinal = msbuildPath || msbuild || 'msbuild';

  // Prepare MSBuild arguments
  const args = [
    '"' + projPath + '"',
    '/t:Build',
    configuration ? `/p:Config=${configuration}` : '',
    platform ? `/p:Platform=${platform}` : ''
  ].filter(Boolean);

  // If rsvars is available, run in a single shell using cmd and call
  if (rsvarsFinal && existsSync(rsvarsFinal)) {
    const cmd = 'cmd';
    const composite = [
      '/s', '/c',
      `"@echo off && call \"${rsvarsFinal}\" && ${msbuildFinal} ${args.join(' ')}"`
    ];
    return await runCommand(cmd, composite);
  }

  // Otherwise, rely on msbuild directly (if in PATH or explicit)
  return await runCommand(msbuildFinal, args);
}

async function cleanWithMSBuild({ project, configuration, platform, msbuildPath, rsvarsPath }: { project: string; configuration?: string; platform?: string; msbuildPath?: string; rsvarsPath?: string; }) {
  const projPath = resolve(project);
  if (!existsSync(projPath)) {
    throw new Error(`Project not found: ${projPath}`);
  }
  if (!isDelphiProject(projPath)) {
    throw new Error('Unsupported project type. Provide a .dproj or .groupproj file');
  }

  const { rsvars, msbuild } = resolveDefaults();
  const rsvarsFinal = rsvarsPath || rsvars;
  const msbuildFinal = msbuildPath || msbuild || 'msbuild';

  const args = [
    '"' + projPath + '"',
    '/t:Clean',
    configuration ? `/p:Config=${configuration}` : '',
    platform ? `/p:Platform=${platform}` : ''
  ].filter(Boolean);

  if (rsvarsFinal && existsSync(rsvarsFinal)) {
    const cmd = 'cmd';
    const composite = [
      '/s', '/c',
      `"@echo off && call \"${rsvarsFinal}\" && ${msbuildFinal} ${args.join(' ')}"`
    ];
    return await runCommand(cmd, composite);
  }

  return await runCommand(msbuildFinal, args);
}

async function main() {
  const mcpServer = new McpServer({
    name: 'mcp-delphi-build',
    version: '1.0.0',
  });

  // Register tools
  mcpServer.registerTool('delphi.build', {
    description: 'Build a Delphi .dproj or .groupproj using MSBuild with RAD Studio environment',
    inputSchema: BuildInput,
  }, async (req: any) => {
    const { code, stdout, stderr } = await buildWithMSBuild(req);
    const ok = code === 0;
    return {
      content: [
        { type: 'text', text: ok ? `Build succeeded for ${basename(req.project)}` : `Build failed for ${basename(req.project)}` },
        { type: 'text', text: `Exit code: ${code}` },
        { type: 'text', text: '--- STDOUT ---\n' + stdout },
        { type: 'text', text: '--- STDERR ---\n' + stderr }
      ],
      isError: !ok
    };
  });

  mcpServer.registerTool('delphi.clean', {
    description: 'Clean a Delphi .dproj or .groupproj using MSBuild with RAD Studio environment',
    inputSchema: CleanInput,
  }, async (req: any) => {
    const { code, stdout, stderr } = await cleanWithMSBuild(req);
    const ok = code === 0;
    return {
      content: [
        { type: 'text', text: ok ? `Clean succeeded for ${basename(req.project)}` : `Clean failed for ${basename(req.project)}` },
        { type: 'text', text: `Exit code: ${code}` },
        { type: 'text', text: '--- STDOUT ---\n' + stdout },
        { type: 'text', text: '--- STDERR ---\n' + stderr }
      ],
      isError: !ok
    };
  });

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch((err) => {
  console.error('Server error:', err);
  process.exit(1);
});

