import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { basename, extname, resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

// Utility: run a command and capture output
function runCommand(cmd: string, args: string[], options: { cwd?: string, env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ code: number | null, stdout: string, stderr: string }>((resolvePromise) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: true, // allow .bat/.cmd wrappers on Windows
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

// FPC build inputs
const FpcBuildInput = {
  source: z.string().describe('Path to a Pascal program (.lpr/.pas) or unit to compile with FPC'),
  output: z.string().optional().describe('Optional output binary path/name'),
  defines: z.array(z.string()).optional().describe('Conditional defines, e.g. FOO=1'),
  unitPaths: z.array(z.string()).optional().describe('Additional unit search paths (-Fu)'),
  includePaths: z.array(z.string()).optional().describe('Additional include search paths (-Fi)'),
  cpu: z.string().optional().describe('Target CPU, e.g. x86_64, i386, aarch64'),
  os: z.string().optional().describe('Target OS, e.g. win64, win32, linux'),
  fpcPath: z.string().optional().describe('Path to fpc compiler (defaults to "fpc")')
};

// Lazarus build/clean inputs
const LazarusBuildInput = {
  project: z.string().describe('Path to a Lazarus project file (.lpi)'),
  buildMode: z.string().optional().describe('Lazarus build mode name (maps to --bm)'),
  cpu: z.string().optional().describe('Target CPU for lazbuild (e.g. x86_64, i386, aarch64)'),
  os: z.string().optional().describe('Target OS for lazbuild (e.g. win64, win32, linux)'),
  lazbuildPath: z.string().optional().describe('Path to lazbuild (defaults to "lazbuild")')
};

const LazarusCleanInput = {
  project: z.string().describe('Path to a Lazarus project file (.lpi)'),
  lazbuildPath: z.string().optional().describe('Path to lazbuild (defaults to "lazbuild")')
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

// -------------------- FPC helpers --------------------
function isFpcSource(file: string) {
  const ext = extname(file).toLowerCase();
  return ext === '.pas' || ext === '.pp' || ext === '.p' || ext === '.lpr';
}

async function buildWithFpc({ source, output, defines, unitPaths, includePaths, cpu, os, fpcPath }: { source: string; output?: string; defines?: string[]; unitPaths?: string[]; includePaths?: string[]; cpu?: string; os?: string; fpcPath?: string; }) {
  const srcPath = resolve(source);
  if (!existsSync(srcPath)) {
    throw new Error(`Source not found: ${srcPath}`);
  }
  if (!isFpcSource(srcPath)) {
    throw new Error('Unsupported source type. Provide a .lpr/.pas/.pp');
  }
  const args: string[] = [];
  if (cpu) args.push(`-P${cpu}`);
  if (os) args.push(`-T${os}`);
  if (output) args.push(`-o${resolve(output)}`);
  (defines || []).forEach(d => args.push(`-d${d}`));
  (unitPaths || []).forEach(p => args.push(`-Fu${resolve(p)}`));
  (includePaths || []).forEach(p => args.push(`-Fi${resolve(p)}`));
  args.push('"' + srcPath + '"');
  const compiler = fpcPath || 'fpc';
  // Use the source directory as CWD so relative includes work
  return await runCommand(compiler, args, { cwd: dirname(srcPath) });
}

// -------------------- Lazarus helpers --------------------
function isLazarusProject(file: string) {
  return extname(file).toLowerCase() === '.lpi';
}

async function lazarusBuild({ project, buildMode, cpu, os, lazbuildPath }: { project: string; buildMode?: string; cpu?: string; os?: string; lazbuildPath?: string; }) {
  const projPath = resolve(project);
  if (!existsSync(projPath)) {
    throw new Error(`Project not found: ${projPath}`);
  }
  if (!isLazarusProject(projPath)) {
    throw new Error('Unsupported project type. Provide a .lpi file');
  }
  const args: string[] = ['--build-mode='];
  if (buildMode) args[0] = `--build-mode=${buildMode}`; else args.pop();
  if (cpu) args.push(`--cpu=${cpu}`);
  if (os) args.push(`--os=${os}`);
  args.push('"' + projPath + '"');
  const lazbuild = lazbuildPath || 'lazbuild';
  return await runCommand(lazbuild, args, { cwd: dirname(projPath) });
}

async function lazarusClean({ project, lazbuildPath }: { project: string; lazbuildPath?: string; }) {
  const projPath = resolve(project);
  if (!existsSync(projPath)) {
    throw new Error(`Project not found: ${projPath}`);
  }
  if (!isLazarusProject(projPath)) {
    throw new Error('Unsupported project type. Provide a .lpi file');
  }
  const args: string[] = ['--clean', '"' + projPath + '"'];
  const lazbuild = lazbuildPath || 'lazbuild';
  return await runCommand(lazbuild, args, { cwd: dirname(projPath) });
}

async function main() {
  const mcpServer = new McpServer({
    name: 'mcp-delphi-build',
    version: '1.1.0',
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

  // FPC tool
  mcpServer.registerTool('fpc.build', {
    description: 'Build with Free Pascal Compiler (fpc) for a Pascal program or project file',
    inputSchema: FpcBuildInput,
  }, async (req: any) => {
    const { code, stdout, stderr } = await buildWithFpc(req);
    const ok = code === 0;
    return {
      content: [
        { type: 'text', text: ok ? `FPC build succeeded for ${basename(req.source)}` : `FPC build failed for ${basename(req.source)}` },
        { type: 'text', text: `Exit code: ${code}` },
        { type: 'text', text: '--- STDOUT ---\n' + stdout },
        { type: 'text', text: '--- STDERR ---\n' + stderr }
      ],
      isError: !ok
    };
  });

  // Lazarus tools
  mcpServer.registerTool('lazarus.build', {
    description: 'Build a Lazarus (.lpi) project using lazbuild',
    inputSchema: LazarusBuildInput,
  }, async (req: any) => {
    const { code, stdout, stderr } = await lazarusBuild(req);
    const ok = code === 0;
    return {
      content: [
        { type: 'text', text: ok ? `Lazarus build succeeded for ${basename(req.project)}` : `Lazarus build failed for ${basename(req.project)}` },
        { type: 'text', text: `Exit code: ${code}` },
        { type: 'text', text: '--- STDOUT ---\n' + stdout },
        { type: 'text', text: '--- STDERR ---\n' + stderr }
      ],
      isError: !ok
    };
  });

  mcpServer.registerTool('lazarus.clean', {
    description: 'Clean Lazarus build artifacts using lazbuild --clean',
    inputSchema: LazarusCleanInput,
  }, async (req: any) => {
    const { code, stdout, stderr } = await lazarusClean(req);
    const ok = code === 0;
    return {
      content: [
        { type: 'text', text: ok ? `Lazarus clean succeeded for ${basename(req.project)}` : `Lazarus clean failed for ${basename(req.project)}` },
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

