export const memorySnapshot = {
  profile: {
    preferred_package_manager: 'npm',
    preferred_editor: 'VS Code',
    style_preferences: ['concise', 'local-first']
  },
  project_scope: 'workspace-local',
  retention_policy: 'user-editable'
};

export const skillsCatalog = [
  {
    name: 'workspace_assessment',
    state: 'verified',
    description: 'Review the repo structure and summarize the project.',
    verification: 'passed local smoke test'
  },
  {
    name: 'safe_typed_tool_execution',
    state: 'verified',
    description: 'Executes guarded operations only after policy checks.',
    verification: 'approval test passed'
  },
  {
    name: 'production_deploy_guard',
    state: 'draft',
    description: 'Requires explicit human approval for production actions.',
    verification: 'pending human validation'
  }
];
