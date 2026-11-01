import type { SandtableApi } from '../shared/api'

declare global {
  interface Window {
    sandtable: SandtableApi
  }
}
