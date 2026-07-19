import type { AgentEvent, HookProvider } from '../../../../../core/src/provider.js';

// CALAJAN is Simviotik's WhatsApp bot (Baileys), not a coding CLI -- it has no
// terminal, no transcript file, no session directory. It's a single persistent
// character that pings this provider directly from its own codebase
// (src/lib/simviotik-live.ts) around each message it processes. See
// docs/superpowers/specs/2026-07-20-simviotik-live-v2-pixel-agents-design.md.

const CALAJAN_SESSION_ID = 'calajan-bot';
const CALAJAN_CWD = 'calajan';

function formatToolStatus(toolName: string): string {
  switch (toolName) {
    case 'ProcesarMensaje':
      return 'Procesando mensaje de WhatsApp';
    default:
      return `Usando ${toolName}`;
  }
}

// normalizeHookEvent: CALAJAN's own raw payload shape (not Claude's), defined
// by us since we author both ends. Three raw hook_event_name values, matching
// the minimal sequence needed to create + drive a hooksOnly agent:
//   SessionStart -> sessionStart (no transcriptPath -> hooksOnly path; safe to
//                   resend, a no-op once the session is already registered)
//   PreToolUse   -> toolStart (shows "working"; buffered until SessionStart's
//                   pending session gets confirmed by the first Stop)
//   Stop         -> turnEnd (confirms + finishes the turn, back to idle)
function normalizeHookEvent(
  raw: Record<string, unknown>,
): { sessionId: string; event: AgentEvent } | null {
  const eventName = raw.hook_event_name;
  const sessionId = raw.session_id;
  if (typeof eventName !== 'string' || typeof sessionId !== 'string') return null;

  switch (eventName) {
    case 'SessionStart':
      return { sessionId, event: { kind: 'sessionStart', cwd: CALAJAN_CWD } };

    case 'PreToolUse': {
      const toolName = typeof raw.tool_name === 'string' ? raw.tool_name : 'ProcesarMensaje';
      return {
        sessionId,
        event: { kind: 'toolStart', toolId: `calajan-${Date.now()}`, toolName },
      };
    }

    case 'Stop':
      return { sessionId, event: { kind: 'turnEnd' } };

    default:
      return null;
  }
}

// No installer: CALAJAN posts to POST /api/hooks/calajan directly from its own
// backend, there's no local CLI to install a hook script into.
function installHooks(): Promise<void> {
  return Promise.resolve();
}
function uninstallHooks(): Promise<void> {
  return Promise.resolve();
}
function areHooksInstalled(): Promise<boolean> {
  return Promise.resolve(true);
}

export const calajanProvider: HookProvider = {
  kind: 'hook',
  id: 'calajan',
  displayName: 'CALAJAN',
  protocolVersion: 1,

  normalizeHookEvent,

  installHooks,
  uninstallHooks,
  areHooksInstalled,

  formatToolStatus,
  permissionExemptTools: new Set(),
  subagentToolNames: new Set(),
  readingTools: new Set(),
};

export { CALAJAN_CWD,CALAJAN_SESSION_ID };
