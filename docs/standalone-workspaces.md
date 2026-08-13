# Standalone workspaces, instructions, and terminals

The standalone adapter is project-agnostic. Select a workspace at startup:

```text
npx @akadirr1/pixel-agent --workspace /path/to/project
```

The default is the current directory. Interactive terminals are local-only and
require `127.0.0.1`, `localhost`, or `::1`. Network monitoring must use
`--no-terminal`.

## Agent instruction discovery

The server discovers Markdown profiles from these directories without changing
the platform repository:

- `.pixel-agents/agents/*.md`
- `.claude/agents/*.md`
- `.codex/agents/*.md`

Optional `.pixel-agents/workspace.json`:

```json
{
  "schemaVersion": 1,
  "name": "My project",
  "includeDefaultAgentSources": true,
  "agentSources": [{ "path": "project-agents", "provider": "claude" }]
}
```

All paths are relative to the selected workspace and must stay inside it. The
Agents & Terminals dock can refresh the list without restarting the server,
shows the complete instruction body, and launches supported profiles in a real
PTY.

Claude profiles are passed at process launch through Claude Code's `--agents`
and `--agent` arguments. This lets `.pixel-agents/agents` remain the neutral
profile store while Claude receives an in-memory provider-specific definition.
Codex profiles are discoverable and readable in the first slice; a launch
adapter will be added only against Codex's explicit instruction interface.

## New project lifecycle

A new project does not rebuild the agent platform. It creates a workspace
manifest and adds or imports instruction files. Profiles remain project-owned,
can be kept in a private project repository, and are loaded dynamically by the
same installed standalone application.
