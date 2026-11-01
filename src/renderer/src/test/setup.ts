import '@testing-library/jest-dom/vitest'
import { cleanup, type RenderOptions } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { drafts } from '@/lib/ticketDrafts'
import { composerDrafts } from '@/lib/composerDrafts'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('@testing-library/react', async (load) => {
  const rtl = await load<typeof import('@testing-library/react')>()
  const render = ((ui: React.ReactNode, options?: RenderOptions) =>
    rtl.render(ui, { wrapper: TooltipProvider, ...options })) as typeof rtl.render
  return { ...rtl, render }
})

afterEach(() => {
  cleanup()
  drafts.clear()
  composerDrafts.clear()
  localStorage.clear()
})

globalThis.ResizeObserver ??= class {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.scrollTo ??= () => {}
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
Element.prototype.checkVisibility ??= () => true
globalThis.IntersectionObserver ??= class {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
} as never
window.matchMedia ??= (query) =>
  ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }) as never
