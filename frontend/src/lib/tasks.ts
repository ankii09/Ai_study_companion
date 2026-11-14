export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

export type Task = {
  id: string
  title: string
  notes: string
  dueDate: string | null
  priority: TaskPriority
  status: TaskStatus
  createdAt: string
  updatedAt: string
}

const TASKS_KEY = 'my-ai-tasks-v1'
const DASHBOARD_KEY = 'my-ai-study-dashboard'
const TASKS_EVENT = 'my-ai-tasks'

const priorities: TaskPriority[] = ['low', 'medium', 'high']
const statuses: TaskStatus[] = ['todo', 'in_progress', 'done']

function isPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && priorities.includes(value as TaskPriority)
}

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && statuses.includes(value as TaskStatus)
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function compareDate(value: string | null): number | null {
  if (!value) return null
  return Number(value.replace(/-/g, ''))
}

export function isOverdue(task: Task, today = localToday()): boolean {
  if (!task.dueDate || task.status === 'done') return false
  return task.dueDate < today
}

export function isDueToday(task: Task, today = localToday()): boolean {
  return task.dueDate === today && task.status !== 'done'
}

function normalizeTask(value: unknown): Task | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Task> & { done?: boolean; title?: string; id?: string }
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) return null
  const now = new Date().toISOString()
  const status = isStatus(raw.status) ? raw.status : raw.done ? 'done' : 'todo'
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: title.slice(0, 200),
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 500) : '',
    dueDate: isDate(raw.dueDate) ? raw.dueDate : null,
    priority: isPriority(raw.priority) ? raw.priority : 'medium',
    status,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  }
}

function readLegacyDashboardTasks(): Task[] {
  try {
    const stored = localStorage.getItem(DASHBOARD_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored) as { tasks?: unknown[] }
    if (!Array.isArray(parsed.tasks)) return []
    return parsed.tasks.map(normalizeTask).filter((task): task is Task => Boolean(task))
  } catch {
    return []
  }
}

function readStoredTasks(): Task[] {
  try {
    const stored = localStorage.getItem(TASKS_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeTask).filter((task): task is Task => Boolean(task))
      }
    }
  } catch {
    // Fall through to the legacy dashboard list.
  }
  return readLegacyDashboardTasks()
}

let cache: Task[] | null = null

export function loadTasks(): Task[] {
  if (!cache) cache = readStoredTasks()
  return cache.map((task) => ({ ...task }))
}

export function saveTasks(tasks: Task[]): Task[] {
  const normalized = tasks.map(normalizeTask).filter((task): task is Task => Boolean(task))
  cache = normalized
  localStorage.setItem(TASKS_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new Event(TASKS_EVENT))
  return loadTasks()
}

export function subscribeTasks(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === TASKS_KEY || event.key === DASHBOARD_KEY) {
      cache = null
      listener()
    }
  }
  const onLocal = () => listener()
  window.addEventListener('storage', onStorage)
  window.addEventListener(TASKS_EVENT, onLocal)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(TASKS_EVENT, onLocal)
  }
}

export function createTask(input: { title: string; notes?: string; dueDate?: string | null; priority?: TaskPriority }): Task {
  const now = new Date().toISOString()
  const task: Task = {
    id: `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim().slice(0, 200),
    notes: (input.notes ?? '').trim().slice(0, 500),
    dueDate: isDate(input.dueDate) ? input.dueDate : null,
    priority: input.priority ?? 'medium',
    status: 'todo',
    createdAt: now,
    updatedAt: now,
  }
  saveTasks([task, ...loadTasks()])
  return task
}

export function patchTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Task | null {
  const tasks = loadTasks()
  const current = tasks.find((task) => task.id === id)
  if (!current) return null
  const next: Task = {
    ...current,
    ...patch,
    title: (patch.title ?? current.title).trim().slice(0, 200),
    notes: (patch.notes ?? current.notes).slice(0, 500),
    dueDate: patch.dueDate === undefined ? current.dueDate : isDate(patch.dueDate) ? patch.dueDate : null,
    updatedAt: new Date().toISOString(),
  }
  saveTasks(tasks.map((task) => task.id === id ? next : task))
  return next
}

export function deleteTask(id: string): void {
  saveTasks(loadTasks().filter((task) => task.id !== id))
}

export function sortTasks(tasks: Task[], today = localToday()): Task[] {
  const rank: Record<TaskStatus, number> = { in_progress: 0, todo: 1, done: 2 }
  const priorityRank: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
  return [...tasks].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
    const aOverdue = a.status !== 'done' && Boolean(a.dueDate && a.dueDate < today)
    const bOverdue = b.status !== 'done' && Boolean(b.dueDate && b.dueDate < today)
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
    const aDue = compareDate(a.dueDate) ?? 99999999
    const bDue = compareDate(b.dueDate) ?? 99999999
    if (aDue !== bDue) return aDue - bDue
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority]
    return a.title.localeCompare(b.title)
  })
}

export function taskStats(tasks: Task[], today = localToday()) {
  const open = tasks.filter((task) => task.status !== 'done')
  return {
    total: tasks.length,
    open: open.length,
    done: tasks.length - open.length,
    today: tasks.filter((task) => isDueToday(task, today)).length,
    overdue: tasks.filter((task) => isOverdue(task, today)).length,
  }
}

export function formatDueLabel(dueDate: string | null, today = localToday()): string {
  if (!dueDate) return 'No date'
  if (dueDate === today) return 'Today'
  const tomorrowDate = new Date(`${today}T00:00:00`)
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`
  if (dueDate === tomorrow) return 'Tomorrow'
  if (dueDate < today) return 'Overdue'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${dueDate}T00:00:00`))
}
