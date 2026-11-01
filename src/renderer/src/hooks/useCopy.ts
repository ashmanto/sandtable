import { useEffect, useState } from 'react'

/** Copies text to the clipboard, with `copied` true until 1.5 s after the latest copy. */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copies, setCopies] = useState(0)
  useEffect(() => {
    if (!copies) return
    const timer = setTimeout(() => setCopies(0), 1500)
    return () => clearTimeout(timer)
  }, [copies])
  return {
    copied: copies > 0,
    copy: (text) => void navigator.clipboard.writeText(text).then(() => setCopies((n) => n + 1))
  }
}
