/**
 * Editor and agent combinations Tracetoon recommends. An editor is not an
 * integration: each workflow runs an agent that already has its own entry in
 * registry.ts, and that agent's adapter reads the logs. Recommending a workflow
 * says nothing about the editor's other agents (Zed's native agent, say).
 *
 * A workflow is `candidate` until the compatibility workflow has a passing run
 * for its `verificationTarget` in compat/verification.json;
 * tests/integrations.test.ts enforces that.
 */
export interface RecommendedWorkflow {
  id: string;
  editor: string;
  /** The integration id (registry.ts) whose hook and adapter this workflow uses. */
  agentIntegrationId: string;
  /** The surface key the compatibility workflow verifies (compat/upstream.json). */
  verificationTarget: string;
  /** What the verification exercises, said plainly for the support table. */
  scope: string;
  state: 'candidate' | 'verified';
}

export const WORKFLOWS: readonly RecommendedWorkflow[] = [
  {
    id: 'vscode-claude',
    editor: 'VS Code',
    agentIntegrationId: 'claude',
    verificationTarget: 'vscode-claude',
    scope: "the Claude Code extension's bundled CLI",
    state: 'candidate',
  },
  {
    id: 'vscode-codex',
    editor: 'VS Code',
    agentIntegrationId: 'codex',
    verificationTarget: 'vscode-codex',
    scope: "the Codex extension's bundled CLI",
    state: 'candidate',
  },
  {
    id: 'vscode-copilot',
    editor: 'VS Code',
    agentIntegrationId: 'copilot',
    verificationTarget: 'vscode-copilot',
    scope: 'Copilot agent mode',
    state: 'candidate',
  },
  {
    id: 'zed-claude',
    editor: 'Zed',
    agentIntegrationId: 'claude',
    verificationTarget: 'zed-claude',
    scope: "Zed's external-agent (ACP) path to Claude Code",
    state: 'candidate',
  },
  {
    id: 'zed-codex',
    editor: 'Zed',
    agentIntegrationId: 'codex',
    verificationTarget: 'zed-codex',
    scope: "Zed's external-agent (ACP) path to Codex",
    state: 'candidate',
  },
];
