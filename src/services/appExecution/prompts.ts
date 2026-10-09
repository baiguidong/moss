export const APP_SUBAGENT_TYPE = 'app-task-agent'
export const APP_SUBAGENT_PROMPT =
  'Complete the assigned task using the available tools. Orchestration belongs to the calling App; do not create agents, teams, or other runs. Report missing prerequisites accurately.'
export function appStructuredSubagentPrompt(toolName: string) {
  return (
    APP_SUBAGENT_PROMPT +
    '\nReturn the requested result through ' +
    toolName +
    ' and end your turn.'
  )
}
export function appStructuredOutputNote(toolName: string) {
  return (
    '\nReturn the result by calling ' +
    toolName +
    '. Its input schema defines the required shape. Correct validation errors; do not replace the structured result with a text acknowledgment.'
  )
}
