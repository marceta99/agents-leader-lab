import { useEffect, useState } from 'react'
import { api } from './api'

/** GET /api/public/prompts: what agents are told by default. */
export type DefaultPrompts = { agent_prompt: string; goals: Record<string, string>; rules: string }

let cached: Promise<DefaultPrompts> | null = null

export function useDefaultPrompts(enabled = true) {
  const [data, setData] = useState<DefaultPrompts | null>(null)
  useEffect(() => {
    if (!enabled) return
    cached ??= api<DefaultPrompts>('/api/public/prompts').catch((e) => {
      cached = null
      throw e
    })
    let live = true
    cached.then((d) => live && setData(d)).catch(() => {})
    return () => {
      live = false
    }
  }, [enabled])
  return data
}

export const AGENT_PROMPT_MAX = 2000
export const GOAL_MAX = 300
