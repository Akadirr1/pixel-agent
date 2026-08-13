import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentProfile, TerminalSession } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';

const MAX_BROWSER_SCROLLBACK_CHARS = 200_000;

type OutputHandler = (data: string) => void;

export interface StandaloneWorkspaceState {
  workspaceName: string;
  workspacePath: string;
  terminalEnabled: boolean;
  profiles: AgentProfile[];
  warnings: string[];
  terminals: TerminalSession[];
  error: string | null;
  refresh(): void;
  createShell(cols?: number, rows?: number): void;
  launchProfile(profileId: string, cols?: number, rows?: number): void;
  sendInput(id: string, data: string): void;
  resizeTerminal(id: string, cols: number, rows: number): void;
  closeTerminal(id: string): void;
  getScrollback(id: string): string;
  subscribeOutput(id: string, handler: OutputHandler): () => void;
}

export function useStandaloneWorkspace(): StandaloneWorkspaceState {
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [terminalEnabled, setTerminalEnabled] = useState(false);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollbackRef = useRef(new Map<string, string>());
  const outputHandlersRef = useRef(new Map<string, Set<OutputHandler>>());

  useEffect(() => {
    const unsubscribe = transport.onMessage((message) => {
      if (message.type === 'agentProfilesLoaded') {
        setWorkspaceName(message.workspaceName);
        setWorkspacePath(message.workspacePath);
        setTerminalEnabled(message.terminalEnabled);
        setProfiles(message.profiles);
        setWarnings(message.warnings);
      } else if (message.type === 'terminalSessions') {
        setTerminals(message.terminals);
      } else if (message.type === 'terminalCreated') {
        setError(null);
        setTerminals((current) => [
          ...current.filter((terminal) => terminal.id !== message.terminal.id),
          message.terminal,
        ]);
      } else if (message.type === 'terminalOutput') {
        const current = scrollbackRef.current.get(message.id) ?? '';
        scrollbackRef.current.set(
          message.id,
          (current + message.data).slice(-MAX_BROWSER_SCROLLBACK_CHARS),
        );
        for (const handler of outputHandlersRef.current.get(message.id) ?? []) {
          handler(message.data);
        }
      } else if (message.type === 'terminalExited') {
        setTerminals((current) =>
          current.map((terminal) =>
            terminal.id === message.terminal.id ? message.terminal : terminal,
          ),
        );
      } else if (message.type === 'terminalClosed') {
        scrollbackRef.current.delete(message.id);
        outputHandlersRef.current.delete(message.id);
        setTerminals((current) => current.filter((terminal) => terminal.id !== message.id));
      } else if (message.type === 'terminalError') {
        setError(message.message);
      }
    });
    transport.send({ type: 'refreshAgentProfiles' });
    return unsubscribe;
  }, []);

  const refresh = useCallback(() => {
    setError(null);
    transport.send({ type: 'refreshAgentProfiles' });
  }, []);

  const createShell = useCallback((cols?: number, rows?: number) => {
    transport.send({ type: 'createTerminal', cols, rows });
  }, []);

  const launchProfile = useCallback((profileId: string, cols?: number, rows?: number) => {
    transport.send({ type: 'createTerminal', profileId, cols, rows });
  }, []);

  const sendInput = useCallback((id: string, data: string) => {
    transport.send({ type: 'terminalInput', id, data });
  }, []);

  const resizeTerminal = useCallback((id: string, cols: number, rows: number) => {
    transport.send({ type: 'terminalResize', id, cols, rows });
  }, []);

  const closeTerminal = useCallback((id: string) => {
    transport.send({ type: 'closeTerminal', id });
  }, []);

  const getScrollback = useCallback((id: string) => scrollbackRef.current.get(id) ?? '', []);

  const subscribeOutput = useCallback((id: string, handler: OutputHandler) => {
    const handlers = outputHandlersRef.current.get(id) ?? new Set<OutputHandler>();
    handlers.add(handler);
    outputHandlersRef.current.set(id, handlers);
    return () => {
      const current = outputHandlersRef.current.get(id);
      current?.delete(handler);
      if (current?.size === 0) outputHandlersRef.current.delete(id);
    };
  }, []);

  return {
    workspaceName,
    workspacePath,
    terminalEnabled,
    profiles,
    warnings,
    terminals,
    error,
    refresh,
    createShell,
    launchProfile,
    sendInput,
    resizeTerminal,
    closeTerminal,
    getScrollback,
    subscribeOutput,
  };
}
