# MCP Delphi Build Server

An MCP (Model Context Protocol) server that exposes tools to build and clean Delphi projects (.dproj/.groupproj) on Windows using MSBuild, initializing the RAD Studio environment via rsvars.bat.

## Prerequisites
- Windows
- Node.js >= 18
- Embarcadero RAD Studio installed (for rsvars.bat and Delphi toolchain)
- MSBuild available (Visual Studio Build Tools or from RAD Studio toolchain)

## Installation
```
pnpm install
pnpm run build
```

Or with npm:
```
npm install
npm run build
```

## Configuration
You can configure defaults via environment variables (use an .env file in this directory if you want):
- RSVARS_BAT: Full path to rsvars.bat (e.g., C:\Program Files (x86)\Embarcadero\Studio\23.0\bin\rsvars.bat)
- MSBUILD_PATH: Full path to msbuild.exe if not in PATH
- DELPHI_CONFIG: Default config (Debug/Release). Default: Release
- DELPHI_PLATFORM: Default platform (Win32/Win64). Default: Win32

Create a .env file like:
```
RSVARS_BAT=C:\Program Files (x86)\Embarcadero\Studio\23.0\bin\rsvars.bat
MSBUILD_PATH=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe
DELPHI_CONFIG=Release
DELPHI_PLATFORM=Win32
```

## Running
This server speaks MCP over stdio. Start it with:
```
node --env-file=.env dist/server.js
```
Or, after installing globally (or as a dependency), run the bin:
```
mcp-delphi-server
```
During development:
```
pnpm run dev
```

## Tools
- delphi.build
  - params: project (string, path to .dproj/.groupproj), configuration? (string), platform? (string), msbuildPath? (string), rsvarsPath? (string)
  - Builds the project using MSBuild. If rsvarsPath (or RSVARS_BAT env) is provided, it will be called before MSBuild in a single shell.
- delphi.clean
  - params: same as delphi.build
  - Cleans the project.

### Test projects and scripts
This repo includes small Delphi test projects in `test/projects` and helper scripts in `scripts/`:
- Build all Release targets:
  - `pnpm run test:build:all`
- Build individually (examples):
  - `pnpm run test:build:console:win32`
  - `pnpm run test:build:console:win64`
  - `pnpm run test:build:vcl:win32`
  - `pnpm run test:build:vcl:win64`
  - `pnpm run test:build:group:win32`
  - `pnpm run test:build:group:win64`
- Clean variants also exist under `test:clean:*`.

## Example invocation 
```
{
  "name": "delphi.build",
  "arguments": {
    "project": "C:/path/to/MyApp.dproj",
    "configuration": "Release",
    "platform": "Win64"
  }
}
```

## Notes
- Windows-only. Requires RAD Studio toolchain and MSBuild.
- For RAD Studio, rsvars.bat sets required environment variables (like BDS, FrameworkDir, Library path). It is recommended to set RSVARS_BAT to ensure the Delphi toolchain is available to MSBuild.
- Group projects (.groupproj) are supported; MSBuild will traverse contained projects.

Planned:
- Add FPC support to the setup.
- Provide a special mORMot2-oriented release/preset.

## Publish
- Ensure `dist` is built: `pnpm run build`
- Optionally test locally via: `pnpm run test:build:all`
- Publish to npm:
  - `npm publish` (or `pnpm publish`)

If publishing under a scope, set the package name accordingly and ensure you are logged in with proper access.

