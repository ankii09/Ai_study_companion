import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, CheckCircle2, Clock3, Plus, Sparkles, Trash2 } from 'lucide-react'
import {
  createTask,
  deleteTask,
  formatDueLabel,
  isDueToday,
  isOverdue,
  loadTasks,
  localToday,
  patchTask,
  sortTasks,
  subscribeTasks,
  taskStats,
  type Task,
  type TaskPriority,
} from '../lib/tasks'

type StudySession = { id: string; subject: string; day: string; time: string; duration: number }
type DashboardExtras = {
  sessions: StudySession[]
  habitChecks: Record<string, string[]>
}

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const habits = [
  { id: 'focus', title: 'Focused study', detail: 'One session with no distractions' },
  { id: 'review', title: 'Review your notes', detail: 'A little recall goes a long way' },
  { id: 'water', title: 'Take care of you', detail: 'Water, a stretch, a real break' },
]
const storageKey = 'my-ai-study-dashboard'
type TaskFilter = 'open' | 'today' | 'overdue' | 'done' | 'all'

function todayKey() {
  return localToday()
}

function weekdayIndex() {
  return new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
}

function readExtras(): DashboardExtras {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DashboardExtras>
      return {
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        habitChecks: parsed.habitChecks && typeof parsed.habitChecks === 'object' ? parsed.habitChecks : {},
      }
    }
  } catch {
    // Start with an empty planner if saved data is unavailable.
  }
  return { sessions: [], habitChecks: {} }
}

function matchesFilter(task: Task, filter: TaskFilter, today: string): boolean {
  if (filter === 'all') return true
  if (filter === 'done') return task.status === 'done'
  if (filter === 'open') return task.status !== 'done'
  if (filter === 'today') return isDueToday(task, today)
  return isOverdue(task, today)
}

export function StudyDashboard({ onOpenChat }: { onOpenChat: () => void }) {
  const [tasks, setTasks] = useState<Task[]>(() => sortTasks(loadTasks()))
  const [extras, setExtras] = useState(readExtras)
  const [taskDraft, setTaskDraft] = useState('')
  const [dueDraft, setDueDraft] = useState('')
  const [priorityDraft, setPriorityDraft] = useState<TaskPriority>('medium')
  const [filter, setFilter] = useState<TaskFilter>('open')
  const [subject, setSubject] = useState('')
  const [sessionDay, setSessionDay] = useState(days[weekdayIndex()])
  const [sessionTime, setSessionTime] = useState('16:00')
  const [duration, setDuration] = useState('45')
  const date = todayKey()
  const checkedHabits = extras.habitChecks[date] ?? []
  const todayName = days[weekdayIndex()]
  const todaySessions = extras.sessions.filter((session) => session.day === todayName).length
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
  const stats = taskStats(tasks, date)
  const progress = stats.total ? Math.round((stats.done / stats.total) * 100) : 0
  const visibleTasks = useMemo(
    () => sortTasks(tasks, date).filter((task) => matchesFilter(task, filter, date)),
    [tasks, filter, date],
  )

  useEffect(() => {
    return subscribeTasks(() => setTasks(sortTasks(loadTasks())))
  }, [])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(extras))
  }, [extras])

  function addTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = taskDraft.trim()
    if (!title) return
    createTask({ title, dueDate: dueDraft || null, priority: priorityDraft })
    setTaskDraft('')
    setDueDraft('')
    setPriorityDraft('medium')
  }

  function toggleTask(task: Task) {
    patchTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' })
  }

  function toggleHabit(id: string) {
    setExtras((current) => {
      const checked = current.habitChecks[date] ?? []
      const next = checked.includes(id) ? checked.filter((item) => item !== id) : [...checked, id]
      return { ...current, habitChecks: { ...current.habitChecks, [date]: next } }
    })
  }

  function addSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = subject.trim()
    if (!title) return
    setExtras((current) => ({
      ...current,
      sessions: [...current.sessions, { id: `${Date.now()}-${Math.random()}`, subject: title, day: sessionDay, time: sessionTime, duration: Number(duration) || 45 }],
    }))
    setSubject('')
  }

  return (
    <section className="study-dashboard">
      <header className="dashboard-heading">
        <div>
          <div className="dashboard-kicker"><Sparkles size={13} /> TASKS & STUDY <span>{dateLabel}</span></div>
          <h1>Make room to learn.</h1>
          <p>Chat can add, complete, and update these tasks. Dates stay in your local timezone.</p>
        </div>
        <button className="dashboard-chat-link" type="button" onClick={onOpenChat}><Sparkles size={15} /> Ask myai</button>
      </header>

      <div className="dashboard-stats" aria-label="Today's overview">
        <article className="dashboard-stat dashboard-stat-progress">
          <div className="stat-label">OPEN TASKS</div>
          <div className="stat-value">{stats.done}<span> / {stats.total} done</span></div>
          <div className="stat-progress-track"><span style={{ width: `${progress}%` }} /></div>
          <small>{stats.overdue ? `${stats.overdue} overdue · ${stats.today} due today` : stats.total ? `${progress}% complete` : 'Add one small thing to begin'}</small>
        </article>
        <article className="dashboard-stat dashboard-stat-habits">
          <div className="stat-label">DAILY CHECK-IN</div>
          <div className="stat-value">{checkedHabits.length}<span> / {habits.length}</span></div>
          <small>Showing up counts, even gently.</small>
        </article>
        <article className="dashboard-stat dashboard-stat-sessions">
          <div className="stat-label">ON YOUR TIMETABLE</div>
          <div className="stat-value">{todaySessions}<span> {todaySessions === 1 ? 'session' : 'sessions'}</span></div>
          <small>{todayName} study plans</small>
        </article>
      </div>

      <div className="dashboard-columns">
        <section className="dashboard-panel task-panel">
          <div className="panel-heading">
            <div><span className="panel-icon task-icon"><CheckCircle2 size={17} /></span><div><h2>Task list</h2><p>Due dates and priorities stay accurate across chat.</p></div></div>
            <span className="panel-count">{stats.open}</span>
          </div>
          <form className="dashboard-add-form task-create-form" onSubmit={addTask}>
            <input aria-label="New task" placeholder="Add a task..." value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} maxLength={200} />
            <input aria-label="Due date" type="date" value={dueDraft} onChange={(event) => setDueDraft(event.target.value)} />
            <select aria-label="Priority" value={priorityDraft} onChange={(event) => setPriorityDraft(event.target.value as TaskPriority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button type="submit" aria-label="Add task" disabled={!taskDraft.trim()}><Plus size={17} /></button>
          </form>
          <div className="task-filters" role="tablist" aria-label="Filter tasks">
            {([
              ['open', 'Open'],
              ['today', 'Today'],
              ['overdue', 'Overdue'],
              ['done', 'Done'],
              ['all', 'All'],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={filter === id ? 'task-filter-active' : ''} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <ul className="task-list">
            {visibleTasks.map((task) => {
              const overdue = isOverdue(task, date)
              return (
                <li className={task.status === 'done' ? 'task-done' : overdue ? 'task-overdue' : ''} key={task.id}>
                  <button className="task-check" type="button" aria-label={task.status === 'done' ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} onClick={() => toggleTask(task)}>{task.status === 'done' && <Check size={13} />}</button>
                  <div className="task-copy">
                    <span>{task.title}</span>
                    <small>
                      <em className={`priority-tag priority-${task.priority}`}>{task.priority}</em>
                      {formatDueLabel(task.dueDate, date)}
                      {task.status === 'in_progress' ? ' · In progress' : ''}
                    </small>
                  </div>
                  <button className="task-delete" type="button" aria-label={`Delete ${task.title}`} onClick={() => deleteTask(task.id)}><Trash2 size={14} /></button>
                </li>
              )
            })}
            {visibleTasks.length === 0 && <li className="dashboard-empty">Nothing in this view. Add a task or ask myai to plan one.</li>}
          </ul>
        </section>

        <section className="dashboard-panel habit-panel">
          <div className="panel-heading">
            <div><span className="panel-icon habit-icon"><Sparkles size={17} /></span><div><h2>Daily little wins</h2><p>Check in with yourself today.</p></div></div>
            <span className="panel-count">{checkedHabits.length}/{habits.length}</span>
          </div>
          <div className="habit-list">
            {habits.map((habit) => {
              const checked = checkedHabits.includes(habit.id)
              return <button className={`habit-row ${checked ? 'habit-checked' : ''}`} type="button" key={habit.id} onClick={() => toggleHabit(habit.id)} aria-pressed={checked}>
                <span className="habit-check">{checked && <Check size={13} />}</span>
                <span className="habit-copy"><strong>{habit.title}</strong><small>{habit.detail}</small></span>
              </button>
            })}
          </div>
          <div className="habit-note"><span>✿</span> Progress, not perfection.</div>
        </section>
      </div>

      <section className="dashboard-panel timetable-panel">
        <div className="panel-heading timetable-heading">
          <div><span className="panel-icon timetable-icon"><BookOpen size={17} /></span><div><h2>Study timetable</h2><p>Give your goals a little space on the calendar.</p></div></div>
          <span className="timetable-total"><Clock3 size={14} /> {extras.sessions.length} planned</span>
        </div>
        <form className="session-form" onSubmit={addSession}>
          <label className="session-subject"><span>Subject or task</span><input aria-label="Subject or study task" placeholder="e.g. Biology: cell structure" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={80} /></label>
          <label><span>Day</span><select aria-label="Study day" value={sessionDay} onChange={(event) => setSessionDay(event.target.value)}>{days.map((day) => <option key={day}>{day}</option>)}</select></label>
          <label><span>Start</span><input aria-label="Start time" type="time" value={sessionTime} onChange={(event) => setSessionTime(event.target.value)} /></label>
          <label><span>Minutes</span><input aria-label="Session length in minutes" type="number" min="10" max="300" step="5" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
          <button className="session-add" type="submit" aria-label="Add study session" disabled={!subject.trim()}><Plus size={17} /><span>Add</span></button>
        </form>
        <div className="week-schedule">
          {days.map((day) => {
            const sessions = extras.sessions.filter((session) => session.day === day).sort((a, b) => a.time.localeCompare(b.time))
            return <div className={`schedule-day ${day === todayName ? 'schedule-today' : ''}`} key={day}>
              <div className="schedule-day-name">{day}<span>{day === todayName ? 'TODAY' : ''}</span></div>
              <div className="schedule-day-sessions">
                {sessions.length ? sessions.map((session) => <div className="session-chip" key={session.id}>
                  <span className="session-time">{session.time}</span><strong>{session.subject}</strong><small>{session.duration} min</small>
                  <button type="button" aria-label={`Remove ${session.subject} from ${day}`} onClick={() => setExtras((current) => ({ ...current, sessions: current.sessions.filter((item) => item.id !== session.id) }))}><Trash2 size={13} /></button>
                </div>) : <span className="schedule-empty">A little room to breathe</span>}
              </div>
            </div>
          })}
        </div>
      </section>
      <footer className="dashboard-footer">Tasks and chats stay in this browser <span>·</span> Ask myai to manage the list for you</footer>
    </section>
  )
}
