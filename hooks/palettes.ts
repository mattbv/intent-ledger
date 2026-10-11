/**
 * Colour palettes for the pane. `default` keeps Claude Code's own theme keys in the terminal and the
 * built-in dark card in the SVGs; the others are named editor themes drawn as raw hex.
 * Pure data: no host imports.
 */

export type Palette = {
  id: string
  label: string
  /** True when the terminal text uses the palette's hex colours; false keeps the host's theme keys. */
  themed: boolean
  /** The SVG card and its text. */
  bg: string
  border: string
  text: string
  dim: string
  edge: string
  /** The shaded current-turn column. */
  surface: string
  /** Status colours, shared by the terminal text and the SVGs. */
  ok: string
  bad: string
  warn: string
  active: string
  off: string
  accent: string
  /** The glyph drawn on a status colour. */
  mark: string
}

export const DEFAULT_PALETTE_ID = 'default'

export const PALETTES: readonly Palette[] = [
  { id: 'default', label: 'Claude Code theme', themed: false, bg: '#0d1117', border: '#30363d', text: '#e6edf3', dim: '#8b949e', edge: '#6e7681', surface: '#161b22', ok: '#2da44e', bad: '#e5534b', warn: '#bf8700', active: '#388bfd', off: '#8c959f', accent: '#d97757', mark: '#0d1117' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', themed: true, bg: '#1e1e2e', border: '#45475a', text: '#cdd6f4', dim: '#a6adc8', edge: '#6c7086', surface: '#313244', ok: '#a6e3a1', bad: '#f38ba8', warn: '#f9e2af', active: '#89b4fa', off: '#6c7086', accent: '#cba6f7', mark: '#1e1e2e' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', themed: true, bg: '#eff1f5', border: '#bcc0cc', text: '#4c4f69', dim: '#6c6f85', edge: '#9ca0b0', surface: '#ccd0da', ok: '#40a02b', bad: '#d20f39', warn: '#df8e1d', active: '#1e66f5', off: '#9ca0b0', accent: '#8839ef', mark: '#eff1f5' },
  { id: 'dracula', label: 'Dracula', themed: true, bg: '#282a36', border: '#44475a', text: '#f8f8f2', dim: '#6272a4', edge: '#6272a4', surface: '#44475a', ok: '#50fa7b', bad: '#ff5555', warn: '#f1fa8c', active: '#8be9fd', off: '#6272a4', accent: '#bd93f9', mark: '#282a36' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', themed: true, bg: '#282828', border: '#504945', text: '#ebdbb2', dim: '#a89984', edge: '#7c6f64', surface: '#3c3836', ok: '#b8bb26', bad: '#fb4934', warn: '#fabd2f', active: '#83a598', off: '#928374', accent: '#fe8019', mark: '#282828' },
  { id: 'tokyo-night', label: 'Tokyo Night', themed: true, bg: '#1a1b26', border: '#3b4261', text: '#c0caf5', dim: '#737aa2', edge: '#565f89', surface: '#292e42', ok: '#9ece6a', bad: '#f7768e', warn: '#e0af68', active: '#7aa2f7', off: '#565f89', accent: '#bb9af7', mark: '#1a1b26' },
  { id: 'nord', label: 'Nord', themed: true, bg: '#2e3440', border: '#434c5e', text: '#d8dee9', dim: '#9aa5b8', edge: '#616e88', surface: '#3b4252', ok: '#a3be8c', bad: '#bf616a', warn: '#ebcb8b', active: '#88c0d0', off: '#616e88', accent: '#b48ead', mark: '#2e3440' },
  { id: 'solarized-dark', label: 'Solarized Dark', themed: true, bg: '#002b36', border: '#0b4a5a', text: '#93a1a1', dim: '#657b83', edge: '#586e75', surface: '#073642', ok: '#859900', bad: '#dc322f', warn: '#b58900', active: '#268bd2', off: '#586e75', accent: '#d33682', mark: '#002b36' },
  { id: 'rose-pine', label: 'Rosé Pine', themed: true, bg: '#191724', border: '#403d52', text: '#e0def4', dim: '#908caa', edge: '#6e6a86', surface: '#26233a', ok: '#9ccfd8', bad: '#eb6f92', warn: '#f6c177', active: '#c4a7e7', off: '#6e6a86', accent: '#ebbcba', mark: '#191724' },
]

export const PALETTE_IDS: readonly string[] = PALETTES.map(p => p.id)

export function paletteOf(id: unknown): Palette {
  return PALETTES.find(p => p.id === id) ?? PALETTES[0]!
}
