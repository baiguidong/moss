import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { SessionRecord } from './types.js'

export type SessionTask = {
  id: string
  subject: string
  description: string
  activeForm: string
  owner: string | null
  status: 'pending' | 'in_progress' | 'completed'
  blockedBy: string[]
}

function normalizeTask(raw: unknown): SessionTask | null {
  if (!raw || typeof raw !== 'object') return null
  const task = raw as Record<string, unknown>
  if (
    typeof task.id !== 'string' || !task.id.trim() ||
    typeof task.subject !== 'string' || !task.subject.trim() ||
    (task.metadata as Record<string, unknown> | null)?._internal
  ) return null
  return {
    id: task.id,
    subject: task.subject,
    description: typeof task.description === 'string' ? task.description : '',
    activeForm: typeof task.activeForm === 'string' ? task.activeForm : '',
    owner: typeof task.owner === 'string' ? task.owner : null,
    status: task.status === 'completed' || task.status === 'in_progress' ? task.status : 'pending',
    blockedBy: Array.isArray(task.blockedBy)
      ? task.blockedBy.filter((id): id is string => typeof id === 'string')
      : [],
  }
}

async function readTaskDirectory(profileDir: string, taskListId: string): Promise<SessionTask[] | null> {
  // Match the runtime's sanitizePathComponent; never use a client-supplied path.
  const dir = join(profileDir, 'tasks', taskListId.replace(/[^a-zA-Z0-9_-]/g, '-'))
  let files
  try {
    files = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const tasks = await Promise.all(files
    .filter(file => file.isFile() && file.name.endsWith('.json') && !file.name.startsWith('.'))
    .map(async file => {
      try {
        return normalizeTask(JSON.parse(await readFile(join(dir, file.name), 'utf8')))
      } catch {
        // TaskUpdate may remove or rewrite a file while the snapshot is read.
        return null
      }
    }))
  return tasks.filter((task): task is SessionTask => task !== null).sort((a, b) => {
    const left = Number.parseInt(a.id, 10)
    const right = Number.parseInt(b.id, 10)
    return !Number.isNaN(left) && !Number.isNaN(right)
      ? left - right : a.id.localeCompare(b.id)
  })
}

async function findSessionTeam(profileDir: string, sessionIds: string[]): Promise<string | null> {
  const dir = join(profileDir, 'teams')
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const teams = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    try {
      const config = JSON.parse(await readFile(join(dir, entry.name, 'config.json'), 'utf8'))
      return sessionIds.includes(config?.leadSessionId)
        ? { id: entry.name, createdAt: Number(config.createdAt) || 0 } : null
    } catch {
      return null
    }
  }))
  // TeamCreate switches the leader's task scope to the most recently created team.
  return teams.filter(team => team !== null).sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? null
}

export async function listSessionTasks(
  session: Pick<SessionRecord, 'sessionId' | 'transcriptSessionId' | 'runtime'>,
): Promise<SessionTask[]> {
  const profileDir = session.runtime.profileDir
  if (!profileDir) return []
  // Resumed runtimes use the transcript's session ID, which may differ from
  // the server record ID. Never combine lists belonging to different scopes.
  const ids = [...new Set([session.transcriptSessionId, session.sessionId].filter(Boolean))]
  const teamId = await findSessionTeam(profileDir, ids)
  if (teamId) return await readTaskDirectory(profileDir, teamId) ?? []
  for (const id of ids) {
    const tasks = await readTaskDirectory(profileDir, id)
    if (tasks !== null) return tasks
  }
  return []
}
