# spawn-agent

Spawn a sub-agent to handle a parallel or follow-up task.

## When to use
- When you discover a task that should run in parallel (e.g., "while I implement X, spawn an agent to write tests for Y")
- When a task is too large and can be split
- When you need specialized work done by a different runtime

## How to use

Write a `.spawn-request.json` file in the project root:

```json
{
  "title": "Brief title for the sub-task",
  "body": "Full instructions for the sub-agent. Be specific — include file paths, requirements, and expected output.",
  "runtimeId": "claude-code",
  "parentIssueNumber": 42
}
```

The Rei execute worker will detect this file after your session ends and automatically queue the sub-task.

## Example

```json
{
  "title": "Write tests for the new auth module",
  "body": "The auth module was just implemented in tools/auth.mjs. Write comprehensive tests in tests/auth.test.mjs covering: login, logout, token refresh, and error cases. Use Node built-in test runner (node:test).",
  "runtimeId": "claude-code",
  "parentIssueNumber": 26
}
```

## Notes
- Only one spawn request per run (file is consumed after detection)
- The spawned task runs after your current session ends
- Sub-task will appear in the Task Queue panel in the Rei Ops Room UI
