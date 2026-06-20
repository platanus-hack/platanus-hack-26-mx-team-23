import { useState } from 'react'
import { recognizeOnce, isSpeechSupported } from '../lib/voice'

type Status = 'idle' | 'listening' | 'sending' | 'done' | 'error'

async function sendTextToActiveTab(text: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab found')
  await chrome.tabs.sendMessage(tab.id, { type: 'OVERLAI_TEXT', text })
}

export function Popup() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [statusMsg, setStatusMsg] = useState('')

  const speechAvailable = isSpeechSupported()

  async function handleMic() {
    setStatus('listening')
    setStatusMsg('Listening...')

    const result = await recognizeOnce()
    if (!result.ok) {
      setStatus('error')
      setStatusMsg(result.error)
      return
    }

    setText(result.text)
    await submitText(result.text)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    await submitText(text.trim())
  }

  async function submitText(query: string) {
    setStatus('sending')
    setStatusMsg(`Sending: "${query}"`)
    try {
      await sendTextToActiveTab(query)
      setStatus('done')
      setStatusMsg('Widget sent to page!')
    } catch (err) {
      setStatus('error')
      setStatusMsg(err instanceof Error ? err.message : 'Failed to send')
    }
  }

  const micLabel =
    status === 'listening'
      ? '... Listening'
      : status === 'sending'
        ? 'Sending...'
        : '🎤 Speak'

  return (
    <div className="w-72 p-4 bg-gray-900 text-white font-sans">
      <h1 className="text-lg font-bold mb-1 text-yellow-400">Overlai</h1>
      <p className="text-xs text-gray-400 mb-4">Voice-driven overlay engine</p>

      {/* Mic button — only shown when speech is available */}
      {speechAvailable && (
        <button
          className="w-full py-3 rounded-xl bg-yellow-400 text-black font-bold text-sm mb-3 cursor-pointer hover:bg-yellow-300 transition-colors disabled:opacity-50"
          onClick={handleMic}
          disabled={status === 'listening' || status === 'sending'}
        >
          {micLabel}
        </button>
      )}

      {/* Text input fallback (always visible) */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "who&apos;s winning?"'
          className="flex-1 px-3 py-2 rounded-lg bg-gray-800 text-white text-sm border border-gray-700 focus:outline-none focus:border-yellow-400"
          disabled={status === 'listening' || status === 'sending'}
        />
        <button
          type="submit"
          className="px-3 py-2 rounded-lg bg-yellow-400 text-black font-bold text-sm hover:bg-yellow-300 transition-colors disabled:opacity-50"
          disabled={!text.trim() || status === 'listening' || status === 'sending'}
        >
          Go
        </button>
      </form>

      {/* Status line */}
      {statusMsg && (
        <p
          className={`mt-3 text-xs text-center ${
            status === 'error' ? 'text-red-400' : status === 'done' ? 'text-green-400' : 'text-gray-400'
          }`}
        >
          {statusMsg}
        </p>
      )}
    </div>
  )
}
