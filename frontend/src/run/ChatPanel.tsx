import { useEffect, useRef } from 'react'
import { fmtTime } from './reducer'
import type { ChatMessage, RunResult } from './types'
import { AGENT_COLORS, STYLE_COLORS } from './types'

const STYLE_LABEL = { directive: 'Directive', non_directive: 'Non-directive', other: 'Other' } as const

const actionText = (a: { kind: string; chair: number | null; cell: [number, number] | null }) =>
  `${a.kind} chair ${a.chair ?? '?'}${a.cell ? ` to (${a.cell[0]},${a.cell[1]})` : ''}`

export default function ChatPanel(props: { messages: ChatMessage[]; result: RunResult | null; follow: boolean }) {
  const { messages, result, follow } = props
  const box = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [messages.length, follow])

  return (
    <section className="rv-panel rv-chat" aria-label="Chat">
      <h2 className="rv-h">Chat</h2>
      {messages.length === 0 && <p className="rv-empty">No messages yet. Agents post here as soon as they start talking.</p>}
      <ol className="rv-chat-list" ref={box}>
        {messages.map((m) => {
          const style = result?.styles?.[String(m.id)]
          const instr = result?.instructions?.filter((i) => i.message_id === m.id) ?? []
          return (
            <li key={m.id} className={instr.length ? 'rv-msg instr' : 'rv-msg'}>
              <div className="rv-msg-head">
                <span className="dot" style={{ background: AGENT_COLORS[m.agent] }} aria-hidden="true" />
                <b>{m.agent}</b>
                <span className="rv-dim tnum">{fmtTime(m.t)}</span>
                {style && (
                  <span className="rv-tag">
                    <span className="dot" style={{ background: STYLE_COLORS[style] }} aria-hidden="true" />
                    {STYLE_LABEL[style]}
                  </span>
                )}
              </div>
              <p className="rv-msg-text">{m.text}</p>
              {instr.map((i, k) => (
                <div key={k} className={i.followed ? 'rv-instr ok' : 'rv-instr no'}>
                  <span aria-hidden="true">{i.followed ? '✓' : '✕'}</span>
                  <span>
                    {i.to}, {actionText(i.action)}: {i.followed ? 'followed' : 'not followed'}
                    {i.followed && (
                      <>
                        , influence <b className="tnum">{i.score.toFixed(2)}</b>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
