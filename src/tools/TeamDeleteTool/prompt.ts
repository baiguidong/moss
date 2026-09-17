export function getPrompt(): string {
  return `
# TeamDelete

Remove team and task directories when the swarm work is complete.

This operation:
- Removes the team directory (\`~/.moss/teams/{team-name}/\`)
- Removes the task directory (\`~/.moss/tasks/{team-name}/\`)
- Clears team context from the current session

**IMPORTANT**: TeamDelete will fail while any non-lead member remains registered, including idle members. Gracefully terminate every teammate first, wait for each shutdown approval, then call TeamDelete.

Use this when all teammates have finished their work and you want to clean up the team resources. The team name is automatically determined from the current session's team context.
`.trim()
}
