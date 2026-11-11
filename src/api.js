// Single source of truth for the backend address.
// - Served over http(s) (Vite dev server with proxy, or nginx in Docker): use same origin.
// - Loaded from file:// (packaged Electron): talk to the local backend directly.
const origin = typeof window !== 'undefined' ? window.location.origin : ''

export const API = /^https?:\/\//.test(origin) ? origin : 'http://localhost:8765'
export const WS_PIPELINE = API.replace(/^http/, 'ws') + '/ws/pipeline'
