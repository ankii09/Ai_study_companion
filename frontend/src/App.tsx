import { useEffect, useRef, useState } from 'react'
import { ArrowUp, BookOpen, Check, CheckCircle2, ChevronDown, CircleHelp, Copy, Menu, Paperclip, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from './components/ui/button'
import { Conversation, Sidebar } from './components/sidebar'
import { defaultPreferences, Preferences, SettingsDialog } from './components/settings-dialog'
import { sendChatMessage } from './lib/api'
import { loadTasks, saveTasks } from './lib/tasks'
import { StudyDashboard } from './components/study-dashboard'

type ChatMessage = Conversation['messages'][number]

const initialConversations: Conversation[] = [
  { id: 'welcome', title: 'A fresh start', group: 'Today', messages: [] },
]

const suggestions = [
  { title: 'Plan today\'s tasks', description: 'Turn a messy to-do pile into a clear list.', emoji: '✅', prompt: 'Look at my current tasks and help me plan today. Add anything important I mention, with due dates in YYYY-MM-DD if I give a day.', tone: 'rose' },
  { title: 'Learn something new', description: 'Explore a topic you\'ve always wondered about.', emoji: '🌷', prompt: 'Teach me something fascinating in a calm, beginner-friendly way.', tone: 'sage' },
  { title: 'Break down a project', description: 'Split a big goal into accurate next steps.', emoji: '🧩', prompt: 'Help me break a project into concrete tasks. Ask what the project is, then add the tasks with priorities and due dates.', tone: 'peach' },
  { title: 'Plan a softer week', description: 'Organize your thoughts and find your rhythm.', emoji: '☁️', prompt: 'Help me plan a calmer, more intentional week with a realistic routine and priorities.', tone: 'lavender' },
]

const markdownComponents = {
  a: (props: any) => <a {...props} target="_blank" rel="noreferrer" />,
  h1: (props: any) => <h1 {...props} />,
  h2: (props: any) => <h2 {...props} />,
  h3: (props: any) => <h3 {...props} />,
  code: ({ className, children, ...props }: any) => (
    <code className={className} {...props}>{children}</code>
  ),
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readPreferences(): Preferences {
  try {
    const stored = localStorage.getItem('my-ai-preferences')
    if (!stored) return defaultPreferences
    const parsed = JSON.parse(stored) as Partial<Preferences>
    return {
      enterToSend: parsed.enterToSend ?? defaultPreferences.enterToSend,
      conciseReplies: parsed.conciseReplies ?? defaultPreferences.conciseReplies,
    }
  } catch {
    return defaultPreferences
  }
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const stored = localStorage.getItem('my-ai-conversations')
      return stored ? JSON.parse(stored) as Conversation[] : initialConversations
    } catch {
      return initialConversations
    }
  })
  const [activeId, setActiveId] = useState(() => {
    try {
      const stored = localStorage.getItem('my-ai-active-id')
      return stored ?? initialConversations[0].id
    } catch {
      return initialConversations[0].id
    }
  })
  const [preferences, setPreferences] = useState(readPreferences)
  const [draft, setDraft] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeView, setActiveView] = useState<'chat' | 'dashboard'>(() => localStorage.getItem('my-ai-active-view') === 'dashboard' ? 'dashboard' : 'chat')
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const activeConversation = conversations.find((item) => item.id === activeId) ?? conversations[0]
  const isFresh = activeConversation?.messages.length === 0

  useEffect(() => {
    localStorage.setItem('my-ai-conversations', JSON.stringify(conversations))
  }, [conversations])

  useEffect(() => {
    localStorage.setItem('my-ai-active-id', activeId)
  }, [activeId])

  useEffect(() => {
    localStorage.setItem('my-ai-active-view', activeView)
  }, [activeView])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeConversation?.messages, sending])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        startNewChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function startNewChat() {
    const id = createId()
    setConversations((current) => [{ id, title: 'A fresh start', group: 'Today', messages: [] }, ...current])
    setActiveId(id)
    setDraft('')
    setMobileOpen(false)
    setActiveView('chat')
    window.setTimeout(() => textareaRef.current?.focus(), 20)
  }

  function savePreferences(next: Preferences) {
    setPreferences(next)
    localStorage.setItem('my-ai-preferences', JSON.stringify(next))
  }

  async function sendMessage(content = draft) {
    const text = content.trim()
    if (!text || sending) return

    const userMessage: ChatMessage = { role: 'user', content: text }
    const previous = activeConversation.messages
    const nextMessages = [...previous, userMessage]
    const title = previous.length === 0 ? text.slice(0, 36) + (text.length > 36 ? '…' : '') : activeConversation.title
    const assistantPlaceholder: ChatMessage = { role: 'assistant', content: '' }

    setConversations((current) => current.map((item) => item.id === activeId ? { ...item, title, messages: [...item.messages, userMessage, assistantPlaceholder] } : item))
    setDraft('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await sendChatMessage(
        nextMessages
          .filter((message) => message.content.trim().length > 0)
          .map((message) => ({ role: message.role, content: message.content })),
        {
          onChunk: (chunk) => {
            const delta = chunk.replace(/\r\n/g, '\n')
            setConversations((current) => current.map((item) => {
              if (item.id !== activeId) return item
              const lastIndex = item.messages.length - 1
              const lastMessage = item.messages[lastIndex]
              if (!lastMessage || lastMessage.role !== 'assistant') return item
              const updatedMessages = [...item.messages]
              updatedMessages[lastIndex] = { ...lastMessage, content: `${lastMessage.content}${delta}` }
              return { ...item, messages: updatedMessages }
            }))
          },
          onTasks: (tasks) => {
            saveTasks(tasks)
            setConversations((current) => current.map((item) => {
              if (item.id !== activeId) return item
              const lastIndex = item.messages.length - 1
              const lastMessage = item.messages[lastIndex]
              if (!lastMessage || lastMessage.role !== 'assistant') return item
              const updatedMessages = [...item.messages]
              updatedMessages[lastIndex] = { ...lastMessage, taskUpdate: true }
              return { ...item, messages: updatedMessages }
            }))
          },
        },
        controller.signal,
        { tasks: loadTasks(), concise: preferences.conciseReplies },
      )
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : 'Something went wrong while connecting to the AI service.'
      setConversations((current) => current.map((item) => {
        if (item.id !== activeId) return item
        const lastMessage = item.messages[item.messages.length - 1]
        const partialContent = lastMessage?.role === 'assistant' ? lastMessage.content : ''
        const errorMessage: ChatMessage = {
          role: 'assistant',
          content: partialContent ? `${partialContent}\n\n${message}` : message,
        }
        return { ...item, messages: [...item.messages.slice(0, -1), errorMessage] }
      }))
    } finally {
      abortRef.current = null
      setSending(false)
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && preferences.enterToSend) {
      event.preventDefault()
      void sendMessage()
    }
  }

  function stopMessage() {
    abortRef.current?.abort()
    abortRef.current = null
    setSending(false)
  }

  async function copyMessage(id: string, content: string) {
    await navigator.clipboard.writeText(content)
    setCopied(id)
    window.setTimeout(() => setCopied(null), 1400)
  }

  function deleteConversation(id: string) {
    const remaining = conversations.filter((item) => item.id !== id)
    if (remaining.length === 0) {
      const fresh = { id: createId(), title: 'A fresh start', group: 'Today' as const, messages: [] }
      setConversations([fresh])
      setActiveId(fresh.id)
    } else {
      setConversations(remaining)
      if (id === activeId) setActiveId(remaining[0].id)
    }
  }

  return (
    <div className="app-shell">
      <Sidebar conversations={conversations} activeId={activeId} activeView={activeView} mobileOpen={mobileOpen} onViewChange={setActiveView} onSelect={(id) => { setActiveId(id); setActiveView('chat') }} onNew={startNewChat} onDelete={deleteConversation} onSettings={() => setSettingsOpen(true)} onClose={() => setMobileOpen(false)} />
      <main className="chat-main">
        <header className="topbar">
          <div className="topbar-left">
            <Button className="mobile-menu" variant="ghost" size="icon" aria-label="Open conversation menu" onClick={() => setMobileOpen(true)}><Menu size={19} /></Button>
            <div className="model-picker">
              <span className="model-sparkle">{activeView === 'chat' ? <Sparkles size={14} /> : <BookOpen size={14} />}</span>
              <span>{activeView === 'chat' ? 'myai' : 'Tasks & study'}</span>
              {activeView === 'chat' && <span className="model-tag">LIVE</span>}
              <ChevronDown size={14} className="model-chevron" />
            </div>
          </div>

          <div className="topbar-actions">
            {activeView === 'chat' && <span className="secure-label"><span className="status-dot" />Private workspace</span>}
            <Button variant="ghost" size="icon" aria-label="Open settings" title="Settings" onClick={() => setSettingsOpen(true)}><CircleHelp size={17} /></Button>
          </div>
        </header>

        {activeView === 'dashboard' ? <StudyDashboard onOpenChat={() => setActiveView('chat')} /> : <section className={`chat-scroll ${isFresh ? 'chat-scroll-welcome' : ''}`}>
          {isFresh ? (
            <div className="welcome-content">
              <div className="welcome-mark">
                <Sparkles size={20} />
              </div>
              <div className="welcome-kicker">your little corner of ideas</div>
              <h1>Little ideas, big possibilities.</h1>
              <p className="welcome-subtitle">Chat, plan tasks, and keep a study timetable in one private workspace.</p>

              <div className="suggestion-grid">
                {suggestions.map(({ title, description, emoji, prompt, tone }, index) => (
                  <button
                    key={title}
                    type="button"
                    className={`suggestion-card suggestion-${tone}`}
                    onClick={() => void sendMessage(prompt)}
                    style={{ animationDelay: `${index * 90}ms` }}
                  >
                    <div className="suggestion-header">
                      <span className="suggestion-icon">{emoji}</span>
                      <span className="suggestion-arrow">→</span>
                    </div>
                    <div className="suggestion-copy">
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-thread">
              <div className="thread-date"><span />A CONVERSATION<span /></div>

              {activeConversation.messages.map((message, index) => (
                <article className={`message-row ${message.role === 'user' ? 'user-row' : 'assistant-row'}`} key={`${activeId}-${index}`}>
                  {message.role === 'assistant' && (
                    <div className="assistant-avatar"><Sparkles size={14} /></div>
                  )}

                  <div className="message-body">
                    <div className="message-author">{message.role === 'user' ? 'You' : 'myai'}</div>

                    {message.role === 'assistant' ? (
                      message.content ? (
                        <div className="message-content markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents as any}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <div className="typing-dots" aria-label="My AI is responding"><i /><i /><i /></div>
                      )
                    ) : (
                      <div className="message-content plain-text">{message.content}</div>
                    )}

                    {message.role === 'assistant' && message.taskUpdate && (
                      <button className="task-update-card" type="button" onClick={() => setActiveView('dashboard')}>
                        <CheckCircle2 size={15} />
                        <span>Task list updated</span>
                        <small>Open tasks</small>
                      </button>
                    )}

                    {message.role === 'assistant' && message.content && (
                      <div className="message-tools">
                        <button aria-label="Copy response" title="Copy response" onClick={() => void copyMessage(`${index}`, message.content)}>
                          {copied === `${index}` ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        <button aria-label="Good response" title="Good response"><ThumbsUp size={14} /></button>
                        <button aria-label="Poor response" title="Poor response"><ThumbsDown size={14} /></button>
                      </div>
                    )}
                  </div>
                </article>
              ))}

              {sending && (
                <div className="composer-stop-row">
                  <Button type="button" variant="ghost" onClick={stopMessage}>Stop</Button>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </section>}

        {activeView === 'chat' && <footer className="composer-area">
          {isFresh && <div className="composer-hint"><span>Private by design</span><span className="hint-separator">·</span><span>Your chats stay in this browser</span></div>}
          <div className="composer-box">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                event.target.style.height = 'auto'
                event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`
              }}
              onKeyDown={handleComposerKeyDown}
              rows={1}
              placeholder="Ask anything, or tell me a task to add..."
              aria-label="Message My AI"
            />
            <div className="composer-controls">
              <div className="composer-left">
                <Button variant="ghost" size="icon" aria-label="Attach file" title="Attachments coming soon" disabled><Paperclip size={16} /></Button>
                <span className="composer-model-label"><span className="composer-dot" />Gemini</span>
              </div>

              <div className="composer-right">
                <span className="enter-hint">{preferences.enterToSend ? '↵ to send' : 'Shift + ↵ for new line'}</span>
                <Button className="send-button" size="icon" aria-label="Send message" disabled={!draft.trim() || sending} onClick={() => void sendMessage()}>
                  <ArrowUp size={17} strokeWidth={2.4} />
                </Button>
              </div>
            </div>
          </div>
          <p className="disclaimer">My AI can make mistakes. Check important information.</p>
        </footer>}
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} preferences={preferences} onSave={savePreferences} />
    </div>
  )
}
