import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceProfileService } from '../src/workspaceProfiles.js';

describe('WorkspaceProfileService', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-workspace-profile-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('discovers neutral and provider-native agent profiles', () => {
    const neutralDir = path.join(workspace, '.pixel-agents', 'agents');
    const claudeDir = path.join(workspace, '.claude', 'agents');
    fs.mkdirSync(neutralDir, { recursive: true });
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(neutralDir, 'planner.md'),
      [
        '---',
        'name: planner',
        'description: Plans bounded work.',
        'provider: claude',
        'model: inherit',
        '---',
        '',
        'Plan from evidence and state assumptions.',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(claudeDir, 'reviewer.md'), '# Reviewer\n\nReview every claim.');

    const snapshot = new WorkspaceProfileService(workspace).load();

    expect(snapshot.profiles).toHaveLength(2);
    expect(snapshot.profiles.find((profile) => profile.name === 'planner')).toMatchObject({
      provider: 'claude',
      launchable: true,
      model: 'inherit',
      sourcePath: '.pixel-agents/agents/planner.md',
    });
    expect(
      snapshot.profiles.find((profile) => profile.name === 'reviewer')?.instructions,
    ).toContain('Review every claim.');
  });

  it('loads manifest sources, deduplicates files, and rejects paths outside the workspace', () => {
    const customDir = path.join(workspace, 'project-agents');
    fs.mkdirSync(path.join(workspace, '.pixel-agents'), { recursive: true });
    fs.mkdirSync(customDir);
    fs.writeFileSync(path.join(customDir, 'agent.md'), 'Custom instruction.');
    fs.writeFileSync(
      path.join(workspace, '.pixel-agents', 'workspace.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'Dynamic project',
        includeDefaultAgentSources: false,
        agentSources: [
          { path: 'project-agents', provider: 'codex' },
          { path: 'project-agents', provider: 'codex' },
          { path: '..', provider: 'claude' },
        ],
      }),
    );

    const snapshot = new WorkspaceProfileService(workspace).load();

    expect(snapshot.workspaceName).toBe('Dynamic project');
    expect(snapshot.profiles).toHaveLength(1);
    expect(snapshot.profiles[0]).toMatchObject({ provider: 'codex', launchable: false });
    expect(snapshot.warnings.join('\n')).toContain('outside the workspace');
  });
});
