import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { AgentProfile, TerminalSession } from '../../../core/src/messages.js';
import { TERMINAL_FONT_FAMILY, TERMINAL_THEME } from '../constants.js';
import type { StandaloneWorkspaceState } from '../hooks/useStandaloneWorkspace.js';
import { Button } from './ui/Button.js';

interface TerminalViewportProps {
  session: TerminalSession;
  workspace: StandaloneWorkspaceState;
}

function TerminalViewport({ session, workspace }: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { getScrollback, resizeTerminal, sendInput, subscribeOutput } = workspace;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 14,
      scrollback: 5000,
      theme: TERMINAL_THEME,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.write(getScrollback(session.id));
    const fit = () => {
      try {
        fitAddon.fit();
        resizeTerminal(session.id, terminal.cols, terminal.rows);
      } catch {
        // The dock can be hidden while ResizeObserver is delivering an old entry.
      }
    };
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);
    const inputDisposable = terminal.onData((data) => sendInput(session.id, data));
    const unsubscribe = subscribeOutput(session.id, (data) => terminal.write(data));
    requestAnimationFrame(fit);
    terminal.focus();
    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      unsubscribe();
      terminal.dispose();
    };
  }, [getScrollback, resizeTerminal, sendInput, session.id, subscribeOutput]);

  return <div ref={containerRef} className="w-full h-full bg-bg-dark" />;
}

interface ProfileCardProps {
  profile: AgentProfile;
  selected: boolean;
  onSelect(): void;
  onLaunch(): void;
}

function ProfileCard({ profile, selected, onSelect, onLaunch }: ProfileCardProps) {
  return (
    <div
      className={`border-2 p-6 cursor-pointer ${selected ? 'border-accent bg-active-bg' : 'border-border bg-bg-dark'}`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base text-text">{profile.name}</div>
          <div className="text-xs text-text-muted">{profile.provider}</div>
        </div>
        {profile.launchable && (
          <Button
            variant="accent"
            onClick={(event) => {
              event.stopPropagation();
              onLaunch();
            }}
          >
            Launch
          </Button>
        )}
      </div>
      <div className="mt-4 text-xs text-text-muted line-clamp-2">{profile.description}</div>
    </div>
  );
}

interface TerminalDockProps {
  isOpen: boolean;
  onClose(): void;
  workspace: StandaloneWorkspaceState;
}

export function TerminalDock({ isOpen, onClose, workspace }: TerminalDockProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const selectedProfile = useMemo(
    () => workspace.profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [selectedProfileId, workspace.profiles],
  );
  const activeTerminal = useMemo(
    () => workspace.terminals.find((terminal) => terminal.id === activeTerminalId) ?? null,
    [activeTerminalId, workspace.terminals],
  );

  useEffect(() => {
    if (!selectedProfileId && workspace.profiles[0]) {
      setSelectedProfileId(workspace.profiles[0].id);
    }
  }, [selectedProfileId, workspace.profiles]);

  useEffect(() => {
    if (workspace.terminals.some((terminal) => terminal.id === activeTerminalId)) return;
    setActiveTerminalId(workspace.terminals.at(-1)?.id ?? null);
  }, [activeTerminalId, workspace.terminals]);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-8 z-40 pixel-panel flex flex-col overflow-hidden">
      <div className="flex items-center gap-6 px-8 py-6 border-b-2 border-border bg-bg-dark">
        <div className="min-w-0 flex-1">
          <div className="text-lg text-text truncate">{workspace.workspaceName || 'Workspace'}</div>
          <div className="text-xs text-text-muted truncate">{workspace.workspacePath}</div>
        </div>
        <Button onClick={workspace.refresh}>Refresh profiles</Button>
        <Button onClick={() => workspace.createShell()} disabled={!workspace.terminalEnabled}>
          + Shell
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>

      {workspace.error && (
        <div className="px-8 py-4 border-b-2 border-danger text-sm text-danger bg-bg-dark">
          {workspace.error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-360 shrink-0 border-r-2 border-border bg-bg p-6 flex flex-col min-h-0">
          <div className="text-sm text-text mb-4">
            Agent instructions ({workspace.profiles.length})
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto pixel-scrollbar pr-2">
            {workspace.profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                selected={profile.id === selectedProfileId}
                onSelect={() => setSelectedProfileId(profile.id)}
                onLaunch={() => {
                  workspace.launchProfile(profile.id);
                  setActiveTerminalId(null);
                }}
              />
            ))}
          </div>
          {selectedProfile && (
            <div className="mt-6 pt-6 border-t-2 border-border min-h-0 flex-1 flex flex-col">
              <div className="text-sm text-text">{selectedProfile.name}</div>
              <div className="text-xs text-text-muted mb-4">{selectedProfile.sourcePath}</div>
              <pre className="m-0 p-5 bg-bg-dark border-2 border-border text-xs text-text whitespace-pre-wrap overflow-auto pixel-scrollbar flex-1">
                {selectedProfile.instructions}
              </pre>
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1 flex flex-col bg-bg-dark">
          <div className="flex items-stretch min-h-44 overflow-x-auto pixel-scrollbar border-b-2 border-border">
            {workspace.terminals.map((terminal) => (
              <div
                key={terminal.id}
                className={`flex items-center gap-4 px-6 border-r-2 border-border cursor-pointer ${terminal.id === activeTerminalId ? 'bg-active-bg' : 'bg-bg'}`}
                onClick={() => setActiveTerminalId(terminal.id)}
              >
                <span className="text-sm whitespace-nowrap">
                  {terminal.title}{' '}
                  <span className="text-xs text-text-muted">
                    {terminal.status === 'exited'
                      ? `[exit ${terminal.exitCode ?? '?'}]`
                      : `[${terminal.pid}]`}
                  </span>
                </span>
                <button
                  className="text-danger bg-transparent border-0 cursor-pointer text-lg"
                  title="Close terminal"
                  onClick={(event) => {
                    event.stopPropagation();
                    workspace.closeTerminal(terminal.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="min-h-0 flex-1 p-4">
            {activeTerminal ? (
              <TerminalViewport
                key={activeTerminal.id}
                session={activeTerminal}
                workspace={workspace}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted">
                Launch an agent profile or open a shell.
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
