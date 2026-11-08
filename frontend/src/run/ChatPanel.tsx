import { useEffect, useRef } from 'react'
import { fmtTime } from './reducer'
import type { ChatMessage, RunResult } from './types'
import { AGENT_COLORS, STYLE_COLORS } from './types'

const STYLE_LABEL = { directive: 'directive', non_directive: 'non-directive', other: 'other' } as const

export default function ChatPanel(props: { messages: ChatMessage[]; result: RunResult | null; follow: boolean }) {
  const { messages, result, follow } = props
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [messages.length, follow])

  return (
    <section className="panel run-chat">
      <h3>Chat</h3>
      <div className="run-chat-list" ref={box}>
        {messages.length === 0 && <div className="muted">No messages yet.</div>}
        {messages.map((m) => {
          const style = result?.styles?.[String(m.id)]
          const instr = result?.instructions?.filter((i) => i.message_id === m.id) ?? []
          return (
            <div key={m.id} className={instr.length ? 'run-msg instr' : 'run-msg'}>
              <div className="run-msg-head">
                <b style={{ color: AGENT_COLORS[m.agent] }}>{m.agent}</b>
                <span className="muted">{fmtTime(m.t)}</span>
                {style && (
                  <span className="run-tag" style={{ background: STYLE_COLORS[style] }}>
                    {STYLE_LABEL[style]}
                  </span>
                )}
              </div>
              <div>{m.text}</div>
              {instr.map((i, k) => (
                <div key={k} className={i.followed ? 'run-instr ok' : 'run-instr no'}>
                  → To {i.to}: {i.followed ? 'followed' : 'not followed'}, influence {i.score.toFixed(2)}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
