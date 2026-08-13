import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';

import type { AgentProfileData } from './workspaceProfiles.js';

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const MIN_COLS = 20;
const MIN_ROWS = 5;
const MAX_COLS = 400;
const MAX_ROWS = 200;
const MAX_SCROLLBACK_CHARS = 200_000;

export interface TerminalSessionData {
  id: string;
  title: string;
  cwd: string;
  pid: number;
  status: 'running' | 'exited';
  profileId?: string;
  exitCode?: number;
}

interface ManagedTerminal {
  metadata: TerminalSessionData;
  process: pty.IPty;
  scrollback: string;
}

export interface CreateTerminalOptions {
  cwd?: string;
  cols?: number;
  rows?: number;
  profile?: AgentProfileData;
}

function environment(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) result[key] = value;
  }
  result.TERM = result.TERM || 'xterm-256color';
  return result;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value as number));
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function shellCommand(): { command: string; args: string[]; title: string } {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'powershell.exe',
      args: [],
      title: 'Shell',
    };
  }
  return {
    command: process.env.SHELL || (os.platform() === 'darwin' ? '/bin/zsh' : '/bin/bash'),
    args: ['-l'],
    title: 'Shell',
  };
}

function profileCommand(profile: AgentProfileData): {
  command: string;
  args: string[];
  title: string;
} {
  if (profile.provider !== 'claude') {
    throw new Error(`Provider ${profile.provider} is not launchable yet`);
  }
  const definition: Record<string, unknown> = {
    description: profile.description,
    prompt: profile.instructions,
  };
  if (profile.model && profile.model !== 'inherit') definition.model = profile.model;
  return {
    command: 'claude',
    args: [
      '--agents',
      JSON.stringify({ [profile.name]: definition }),
      '--agent',
      profile.name,
      '--name',
      profile.name,
    ],
    title: profile.name,
  };
}

export class StandaloneTerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, ManagedTerminal>();

  constructor(readonly workspaceRoot: string) {
    super();
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  list(): TerminalSessionData[] {
    return [...this.sessions.values()].map((session) => ({ ...session.metadata }));
  }

  create(options: CreateTerminalOptions = {}): TerminalSessionData {
    const cwd = path.resolve(this.workspaceRoot, options.cwd || '.');
    if (!isInside(this.workspaceRoot, cwd)) {
      throw new Error('Terminal working directory must stay inside the selected workspace');
    }
    const executable = options.profile ? profileCommand(options.profile) : shellCommand();
    const cols = clampInteger(options.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS);
    const rows = clampInteger(options.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS);
    const child = pty.spawn(executable.command, executable.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: environment(),
    });
    const id = randomUUID();
    const metadata: TerminalSessionData = {
      id,
      title: executable.title,
      cwd,
      pid: child.pid,
      status: 'running',
      ...(options.profile ? { profileId: options.profile.id } : {}),
    };
    const managed: ManagedTerminal = { metadata, process: child, scrollback: '' };
    this.sessions.set(id, managed);
    child.onData((data) => {
      managed.scrollback = (managed.scrollback + data).slice(-MAX_SCROLLBACK_CHARS);
      this.emit('output', id, data);
    });
    child.onExit(({ exitCode }) => {
      managed.metadata.status = 'exited';
      managed.metadata.exitCode = exitCode;
      this.emit('exited', { ...managed.metadata });
    });
    this.emit('created', { ...metadata });
    return { ...metadata };
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session || session.metadata.status !== 'running') return;
    session.process.write(data);
  }

  resize(id: string, cols?: number, rows?: number): void {
    const session = this.sessions.get(id);
    if (!session || session.metadata.status !== 'running') return;
    session.process.resize(
      clampInteger(cols, DEFAULT_COLS, MIN_COLS, MAX_COLS),
      clampInteger(rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS),
    );
  }

  snapshot(id: string): string {
    return this.sessions.get(id)?.scrollback ?? '';
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.metadata.status === 'running') session.process.kill();
    this.sessions.delete(id);
    this.emit('closed', id);
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
    this.removeAllListeners();
  }
}
