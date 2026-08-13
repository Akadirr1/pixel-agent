import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StandaloneTerminalManager } from '../src/standaloneTerminalManager.js';

const OUTPUT_TIMEOUT_MS = 5_000;

describe('StandaloneTerminalManager', () => {
  let workspace: string;
  let manager: StandaloneTerminalManager;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-terminal-'));
    manager = new StandaloneTerminalManager(workspace);
  });

  afterEach(async () => {
    manager.dispose();
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        fs.rmSync(workspace, { recursive: true, force: true });
        return;
      } catch (error) {
        if (attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  });

  it('opens a PTY, streams output, and retains scrollback', async () => {
    const lineEnding = process.platform === 'win32' ? '\r' : '\n';
    const output = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('terminal output timeout')),
        OUTPUT_TIMEOUT_MS,
      );
      let collected = '';
      manager.on('output', (_id: string, data: string) => {
        collected += data;
        if (collected.includes('pixel-terminal-ok')) {
          clearTimeout(timer);
          resolve(collected);
        }
      });
    });
    const session = manager.create();
    manager.write(session.id, `echo pixel-terminal-ok${lineEnding}`);

    expect(await output).toContain('pixel-terminal-ok');
    expect(manager.snapshot(session.id)).toContain('pixel-terminal-ok');
    expect(manager.list()).toHaveLength(1);
    const exited = new Promise<void>((resolve) => manager.once('exited', () => resolve()));
    manager.write(session.id, `exit${lineEnding}`);
    await exited;
  });

  it('rejects a working directory outside the selected workspace', () => {
    expect(() => manager.create({ cwd: '..' })).toThrow(/inside the selected workspace/);
  });
});
