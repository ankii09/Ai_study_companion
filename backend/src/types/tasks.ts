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

export type ChatContext = {
  today: string
  timeZone: string
  concise?: boolean
}
