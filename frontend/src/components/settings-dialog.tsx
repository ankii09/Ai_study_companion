import * as Dialog from '@radix-ui/react-dialog'
import { Check, ChevronDown, Settings2, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui/button'

export type Preferences = {
  enterToSend: boolean
  conciseReplies: boolean
}

export const defaultPreferences: Preferences = {
  enterToSend: true,
  conciseReplies: false,
}

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  preferences: Preferences
  onSave: (preferences: Preferences) => void
}

export function SettingsDialog({ open, onOpenChange, preferences, onSave }: SettingsDialogProps) {
  const [draft, setDraft] = useState(preferences)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(preferences)
      setSaved(false)
    }
  }, [open, preferences])

  function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave(draft)
    setSaved(true)
    window.setTimeout(() => onOpenChange(false), 450)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="settings-dialog">
          <div className="dialog-heading">
            <div className="dialog-icon"><Settings2 size={18} /></div>
            <div>
              <Dialog.Title className="dialog-title">Settings</Dialog.Title>
              <Dialog.Description className="dialog-description">Tune how chat feels in this browser.</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close settings"><X size={17} /></Button></Dialog.Close>
          </div>

          <form onSubmit={saveSettings}>
            <section className="settings-section preferences-section">
              <div className="settings-section-title"><SlidersHorizontal size={15} /><span>Chat preferences</span></div>
              <p className="field-hint">The Gemini API key stays on the server. Nothing you type here is sent as a credential.</p>
              <label className="toggle-row">
                <span><strong>Enter to send</strong><small>Use Shift + Enter for a new line.</small></span>
                <input type="checkbox" checked={draft.enterToSend} onChange={(event) => setDraft({ ...draft, enterToSend: event.target.checked })} />
              </label>
              <label className="toggle-row">
                <span><strong>Concise replies</strong><small>Prefer shorter, direct answers.</small></span>
                <input type="checkbox" checked={draft.conciseReplies} onChange={(event) => setDraft({ ...draft, conciseReplies: event.target.checked })} />
              </label>
            </section>

            <div className="dialog-footer">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="save-button">{saved ? <><Check size={15} /> Saved</> : 'Save changes'}<ChevronDown size={14} className="save-chevron" /></Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
