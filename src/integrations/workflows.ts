/**
 * Editor and agent combinations Tracetoon recommends. An editor is not an
 * integration: each workflow runs an agent that already has its own entry in
 * registry.ts, and that agent's adapter reads the logs. Recommending a workflow
 * says nothing about the editor's other agents (Zed's native agent, say).
 *
 * There is no hand-set "verified" flag: the support docs call a workflow
 * verified only when compat/verification.json has a passing run for its
 * `verificationTarget`. A workflow whose target isn't in compat/upstream.json
 * has no automated route yet and is listed as a candidate.
 */
export interface RecommendedWorkflow {
  id: string;
  editor: string;
  /** The integration id (registry.ts) whose hook and adapter this workflow uses. */
  agentIntegrationId: string;
  /** The target the compatibility workflow verifies (a key of compat/upstream.json). */
  verificationTarget: string;
  /** What the verification exercises, said plainly for the support table. */
  scope: string;
}

export const WORKFLOWS: readonly RecommendedWorkflow[] = [
  {
    id: 'vscode-claude',
    editor: 'VS Code',
    agentIntegrationId: 'claude',
    verificationTarget: 'vscode-claude',
    scope: "the Claude Code extension's bundled CLI (route not built yet)",
  },
  {
    id: 'vscode-codex',
    editor: 'VS Code',
    agentIntegrationId: 'codex',
    verificationTarget: 'vscode-codex',
    scope: "the Codex extension's bundled CLI (route not built yet)",
  },
  {
    id: 'vscode-copilot',
    editor: 'VS Code',
    agentIntegrationId: 'copilot',
    verificationTarget: 'vscode-copilot',
    scope: 'Copilot agent mode (runs in the editor window; no headless route yet)',
  },
  {
    id: 'zed-claude',
    editor: 'Zed',
    agentIntegrationId: 'claude',
    verificationTarget: 'zed-claude',
    scope: "Zed's external-agent (ACP) path to Claude Code",
  },
  {
    id: 'zed-codex',
    editor: 'Zed',
    agentIntegrationId: 'codex',
    verificationTarget: 'zed-codex',
    scope: "Zed's external-agent (ACP) path to Codex",
  },
];
