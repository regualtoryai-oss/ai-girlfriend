/** Local WAV input uses the same author ASR and conversation path, without microphone access. */
import { useEffect, useRef, useState } from 'react'
import type { VoiceInjected } from './contract.ts'
import { stt } from './bridge.ts'

export function FileAudioButton({sendText, interruptReply, onBusy}: Pick<VoiceInjected, 'sendText' | 'interruptReply'> & {onBusy?: (busy: boolean) => void}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { onBusy?.(busy) }, [busy, onBusy])
  const [status, setStatus] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  return <span style={{fontSize: 12, marginRight: 8}}>
    <button type="button" disabled={busy} onClick={() => input.current?.click()} title="选择本地 WAV，识别后需确认文字；不会打开麦克风">{busy ? '识别音频中…' : '发送音频文件'}</button>
    <input ref={input} type="file" accept=".wav,audio/wav" aria-label="选择 WAV 音频文件" hidden onChange={async event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      if (file.size > 2 * 1024 * 1024) { setStatus('请选择 2 MB 内、30 秒内的 WAV'); return }
      setBusy(true); setStatus(''); setDraft(null); interruptReply()
      try {
        const {text} = await stt(await file.arrayBuffer())
        if (!text.trim()) { setStatus('未识别到文字'); return }
        setStatus(`识别：${text}`)
        setDraft(text.trim())
      } catch { setStatus('音频识别或发送失败，请检查语音服务与音频格式') }
      finally { setBusy(false) }
    }}/>
    {draft !== null && <span style={{display: 'block', maxWidth: 560}}>
      <label>检查识别文字，确认前不会发送任务。
        <textarea aria-label="待确认的音频文件转写" value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} rows={2} style={{width: '100%'}} />
      </label>
      <button type="button" disabled={busy || !draft.trim()} onClick={async () => {
        setBusy(true)
        try { await sendText(draft.trim()); setDraft(null); setStatus('已确认发送') }
        catch { setStatus('发送失败，文字已保留') }
        finally { setBusy(false) }
      }}>确认发送音频文字</button>
      <button type="button" disabled={busy} onClick={() => {setDraft(null); setStatus('已丢弃')}}>丢弃音频转写</button>
    </span>}
    {status && <span role="status" style={{display:'block',maxWidth:440}}>{status}</span>}
  </span>
}
