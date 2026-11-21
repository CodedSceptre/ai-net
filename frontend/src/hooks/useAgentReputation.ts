import { useEffect, useMemo, useState } from 'react'
import { getAgentReputation, getAgentReputationHistory } from '../services/api'
import type { AgentReputation, ReputationHistory } from '../types/agent'

const DAY_MS = 86_400_000

const scoreBreakdown = [
  { name: 'Task Success', weight: 50, color: 'var(--accent-info, #3b82f6)' },
  { name: 'Dispute Resolution', weight: 30, color: 'var(--accent-purple, #8b5cf6)' },
  { name: 'Response Time', weight: 20, color: 'var(--accent-teal, #14b8a6)' },
]

export type ReputationSegment = (typeof scoreBreakdown)[number]

export interface ReputationPoint {
  date: string
  score: number | null
  delta: number | null
}

function dailyHistory(history: ReputationHistory[], today: number) {
  const lastDay = Math.floor(today / DAY_MS)
  const days = new Map<number, { score: number; timestamp: number }>()
  for (const item of history) {
    const timestamp = Date.parse(item.date)
    if (!Number.isFinite(timestamp) || !Number.isFinite(item.score)) continue
    const day = Math.floor(timestamp / DAY_MS)
    if (day < lastDay - 29 || day > lastDay) continue
    if (timestamp >= (days.get(day)?.timestamp ?? -Infinity)) {
      days.set(day, { score: item.score, timestamp })
    }
  }
  if (days.size < 2) return []

  let previous: number | null = null
  return Array.from({ length: 30 }, (_, index): ReputationPoint => {
    const day = lastDay - 29 + index
    const score = days.get(day)?.score ?? previous
    const delta = score === null || previous === null ? null : score - previous
    previous = score
    return { date: new Date(day * DAY_MS).toISOString(), score, delta }
  })
}

export function useAgentReputation(agentId: string, { includeSummary = true } = {}) {
  const [summary, setSummary] = useState<{ agentId: string; data: AgentReputation | null }>()
  const [result, setResult] = useState<{
    agentId: string
    fetchKey: number
    history: ReputationHistory[]
    error: string | null
    receivedAt: number
  }>()
  const [fetchKey, setFetchKey] = useState(0)

  useEffect(() => {
    if (!agentId) return
    let active = true
    if (includeSummary) {
      getAgentReputation(agentId).then(
        (data) => { if (active) setSummary({ agentId, data }) },
        () => { if (active) setSummary({ agentId, data: null }) },
      )
    }
    getAgentReputationHistory(agentId).then(
      (history) => {
        if (active) setResult({ agentId, fetchKey, history, error: null, receivedAt: Date.now() })
      },
      (error: unknown) => {
        if (active) setResult({
          agentId,
          fetchKey,
          history: [],
          error: error instanceof Error ? error.message : 'Failed to load reputation history',
          receivedAt: Date.now(),
        })
      },
    )
    return () => { active = false }
  }, [agentId, fetchKey, includeSummary])

  const current = result?.agentId === agentId && result.fetchKey === fetchKey ? result : undefined
  const historyPoints = useMemo(
    () => current ? dailyHistory(current.history, current.receivedAt) : [],
    [current],
  )
  const latest = historyPoints[29]?.score
  const weekAgo = historyPoints[22]?.score
  const trendSummary = latest == null || weekAgo == null ? null : Number((latest - weekAgo).toFixed(1))
  const isLoading = Boolean(agentId && !current)

  return {
    data: summary?.agentId === agentId ? summary.data : null,
    loading: Boolean(agentId && includeSummary && summary?.agentId !== agentId),
    history: current?.history ?? [],
    historyLoading: isLoading,
    historyPoints,
    scoreBreakdown,
    trendSummary,
    isLoading,
    error: current?.error ?? null,
    refetch: () => setFetchKey((key) => key + 1),
  }
}
