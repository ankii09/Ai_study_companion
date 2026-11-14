import type { Task, TaskPriority, TaskStatus } from '../types/tasks.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high']
const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done']

export type ToolResult = {
  ok: boolean
  error?: string
  task?: Task
  tasks?: Task[]
  message?: string
}

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseDueDate(value: unknown): string | null | undefined {
  if (value === null) return null
  if (value === undefined || value === '') return undefined
  const text = asString(value)
  if (!text) return null
  if (text.toLowerCase() === 'none' || text.toLowerCase() === 'clear') return null
  return isValidDate(text) ? text : '__invalid__'
}

function parsePriority(value: unknown): TaskPriority | undefined {
  const text = asString(value).toLowerCase()
  if (!text) return undefined
  return PRIORITIES.includes(text as TaskPriority) ? text as TaskPriority : undefined
}

function parseStatus(value: unknown): TaskStatus | undefined {
  const text = asString(value).toLowerCase().replace(/[-\s]/g, '_')
  if (text === 'complete' || text === 'completed' || text === 'finished') return 'done'
  if (text === 'open' || text === 'pending') return 'todo'
  if (text === 'doing' || text === 'working') return 'in_progress'
  return STATUSES.includes(text as TaskStatus) ? text as TaskStatus : undefined
}

function nowIso(): string {
  return new Date().toISOString()
}

function createId(): string {
  return `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function cloneTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => ({ ...task }))
}

function findTask(tasks: Task[], args: Record<string, unknown>): { task?: Task; error?: string } {
  const id = asString(args.id || args.taskId)
  const title = asString(args.title || args.query)

  if (id) {
    const match = tasks.find((task) => task.id === id)
    if (match) return { task: match }
  }

  if (title) {
    const needle = title.toLowerCase()
    const exact = tasks.filter((task) => task.title.toLowerCase() === needle)
    if (exact.length === 1) return { task: exact[0] }
    if (exact.length > 1) {
      return { error: `Several tasks are titled "${title}". Use an id: ${exact.map((task) => task.id).join(', ')}.` }
    }

    const partial = tasks.filter((task) => task.title.toLowerCase().includes(needle))
    if (partial.length === 1) return { task: partial[0] }
    if (partial.length > 1) {
      return {
        error: `That title is ambiguous. Matching tasks: ${partial.map((task) => `${task.id} (${task.title})`).join('; ')}.`,
      }
    }
  }

  return { error: 'No matching task. Call list_tasks and use the exact id.' }
}

function serialize(task: Task) {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    dueDate: task.dueDate,
    priority: task.priority,
    status: task.status,
  }
}

export function applyTaskTool(tasks: Task[], name: string, rawArgs: unknown): { tasks: Task[]; result: ToolResult } {
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? rawArgs as Record<string, unknown>
    : typeof rawArgs === 'string'
      ? safeJson(rawArgs)
      : {}

  const next = cloneTasks(tasks)

  switch (name) {
    case 'create_task': {
      const title = asString(args.title)
      if (!title) return { tasks, result: { ok: false, error: 'A task title is required.' } }
      const dueDate = parseDueDate(args.dueDate ?? args.due)
      if (dueDate === '__invalid__') {
        return { tasks, result: { ok: false, error: 'dueDate must be YYYY-MM-DD or empty.' } }
      }
      const priority = parsePriority(args.priority) ?? 'medium'
      const created: Task = {
        id: createId(),
        title: title.slice(0, 200),
        notes: asString(args.notes).slice(0, 500),
        dueDate: dueDate ?? null,
        priority,
        status: 'todo',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      next.unshift(created)
      return { tasks: next, result: { ok: true, task: created, message: `Created task ${created.id}.` } }
    }
    case 'update_task': {
      const found = findTask(next, args)
      if (!found.task) return { tasks, result: { ok: false, error: found.error } }
      const dueDate = parseDueDate(args.dueDate ?? args.due)
      if (dueDate === '__invalid__') {
        return { tasks, result: { ok: false, error: 'dueDate must be YYYY-MM-DD or empty.' } }
      }
      const rename = asString(args.newTitle) || (asString(args.id) ? asString(args.title) : '')
      const notes = args.notes === undefined ? undefined : asString(args.notes).slice(0, 500)
      const priority = parsePriority(args.priority)
      const status = parseStatus(args.status)
      const updated: Task = {
        ...found.task,
        title: rename ? rename.slice(0, 200) : found.task.title,
        notes: notes ?? found.task.notes,
        dueDate: dueDate === undefined ? found.task.dueDate : dueDate,
        priority: priority ?? found.task.priority,
        status: status ?? found.task.status,
        updatedAt: nowIso(),
      }
      return {
        tasks: next.map((task) => task.id === updated.id ? updated : task),
        result: { ok: true, task: updated, message: `Updated task ${updated.id}.` },
      }
    }
    case 'complete_task': {
      const found = findTask(next, args)
      if (!found.task) return { tasks, result: { ok: false, error: found.error } }
      const updated = { ...found.task, status: 'done' as const, updatedAt: nowIso() }
      return {
        tasks: next.map((task) => task.id === updated.id ? updated : task),
        result: { ok: true, task: updated, message: `Completed task ${updated.id}.` },
      }
    }
    case 'reopen_task': {
      const found = findTask(next, args)
      if (!found.task) return { tasks, result: { ok: false, error: found.error } }
      const updated = { ...found.task, status: 'todo' as const, updatedAt: nowIso() }
      return {
        tasks: next.map((task) => task.id === updated.id ? updated : task),
        result: { ok: true, task: updated, message: `Reopened task ${updated.id}.` },
      }
    }
    case 'delete_task': {
      const found = findTask(next, args)
      if (!found.task) return { tasks, result: { ok: false, error: found.error } }
      return {
        tasks: next.filter((task) => task.id !== found.task!.id),
        result: { ok: true, task: found.task, message: `Deleted task ${found.task.id}.` },
      }
    }
    case 'list_tasks': {
      const status = parseStatus(args.status)
      const due = parseDueDate(args.dueDate ?? args.due)
      let listed = next
      if (status) listed = listed.filter((task) => task.status === status)
      if (due && due !== '__invalid__') listed = listed.filter((task) => task.dueDate === due)
      return {
        tasks,
        result: {
          ok: true,
          tasks: listed,
          message: listed.length ? `Found ${listed.length} task(s).` : 'No tasks matched that filter.',
        },
      }
    }
    default:
      return { tasks, result: { ok: false, error: `Unknown tool: ${name}` } }
  }
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function formatTaskSnapshot(tasks: Task[]): string {
  if (tasks.length === 0) return 'The user currently has no tasks.'
  return tasks.map((task) => {
    const due = task.dueDate ? `due ${task.dueDate}` : 'no due date'
    const notes = task.notes ? ` notes: ${task.notes}` : ''
    return `- ${task.id} | ${task.title} | ${task.status} | ${task.priority} | ${due}${notes}`
  }).join('\n')
}

export function summarizeTasks(tasks: Task[]) {
  return tasks.map(serialize)
}
