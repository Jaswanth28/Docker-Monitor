import { useNavigate, useLocation } from "react-router-dom"

/**
 * Back navigation that respects how the page was reached:
 * - opened from a stack's monitor page (state.from === "stack") -> back to that stack
 * - opened via in-app navigation with real history -> browser back
 * - opened directly (deep link / refresh, no history) -> the given fallback route
 */
export function useBackTo(fallback: string) {
  const nav = useNavigate()
  const location = useLocation()
  return () => {
    const state = location.state as { from?: string; stack?: string } | null
    if (state?.from === "stack" && state.stack) {
      nav(`/stacks/${state.stack}`)
      return
    }
    const idx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof idx === "number" && idx > 0) {
      nav(-1)
      return
    }
    nav(fallback)
  }
}
