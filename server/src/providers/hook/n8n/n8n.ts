import type { AgentEvent, HookProvider } from '../../../../../core/src/provider.js';

// n8n is Simviotik's workflow-automation engine, not a coding CLI -- same
// shape as the calajan provider (see calajan.ts for the full rationale): one
// persistent character, no terminal/transcript, driven by a plain HTTP node
// added to the real workflow. See
// docs/superpowers/specs/2026-07-20-simviotik-live-v2-pixel-agents-design.md.

const N8N_SESSION_ID = 'n8n-bot';
const N8N_CWD = 'n8n';

function formatToolStatus(toolName: string): string {
  switch (toolName) {
    case 'EjecutarWorkflow':
      return 'Ejecutando workflow';
    default:
      return `Usando ${toolName}`;
  }
}

function normalizeHookEvent(
  raw: Record<string, unknown>,
): { sessionId: string; event: AgentEvent } | null {
  const eventName = raw.hook_event_name;
  const sessionId = raw.session_id;
  if (typeof eventName !== 'string' || typeof sessionId !== 'string') return null;

  switch (eventName) {
    case 'SessionStart':
      return { sessionId, event: { kind: 'sessionStart', cwd: N8N_CWD } };

    case 'PreToolUse': {
      const toolName = typeof raw.tool_name === 'string' ? raw.tool_name : 'EjecutarWorkflow';
      return {
        sessionId,
        event: { kind: 'toolStart', toolId: `n8n-${Date.now()}`, toolName },
      };
    }

    case 'Stop':
      return { sessionId, event: { kind: 'turnEnd' } };

    default:
      return null;
  }
}

function installHooks(): Promise<void> {
  return Promise.resolve();
}
function uninstallHooks(): Promise<void> {
  return Promise.resolve();
}
function areHooksInstalled(): Promise<boolean> {
  return Promise.resolve(true);
}

export const n8nProvider: HookProvider = {
  kind: 'hook',
  id: 'n8n',
  displayName: 'n8n',
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

export { N8N_CWD,N8N_SESSION_ID };
