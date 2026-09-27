/**
 * Material Design 3 theme for the video site (see config.json for branding).
 *
 * Colour roles follow the MD3 baseline naming used by Vuetify 3 (primary,
 * on-primary, primary-container, surface, surface-variant, ...).
 *
 * The palette is a soft green ("淡绿色") scheme: the primary is a light green
 * with a dark on-colour, and the neutrals are green-tinted so the whole page
 * reads green rather than purple.
 */
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { siteConfig } from '@/constants'
import { accentRoles, isDefaultPrimary, normalizeHex, primaryRoles, readableOn } from '@/utils/theme'

const light = {
  dark: false,
  colors: {
    background: '#F4FAF6',
    'on-background': '#191C1A',
    surface: '#FFFFFF',
    'on-surface': '#191C1A',
    'surface-variant': '#DCE8E0',
    'on-surface-variant': '#404943',
    'surface-bright': '#FFFFFF',
    'surface-light': '#EDF6F0',
    'surface-dim': '#D5E2D9',
    'surface-container-lowest': '#FFFFFF',
    'surface-container-low': '#EFF8F2',
    'surface-container': '#E9F3ED',
    'surface-container-high': '#E3EEE7',
    'surface-container-highest': '#DDE9E1',
    'inverse-surface': '#2E312F',
    'inverse-on-surface': '#EFF1EE',
    outline: '#6F7973',
    'outline-variant': '#BECBC2',
    primary: '#6BBF8A',
    'on-primary': '#0B3B22',
    'primary-container': '#C9EED8',
    'on-primary-container': '#07301B',
    'primary-darken-1': '#4A9C6D',
    'primary-lighten-1': '#8FD3AA',
    secondary: '#4A6572',
    'on-secondary': '#FFFFFF',
    'secondary-container': '#CDE7F5',
    'on-secondary-container': '#051F29',
    'secondary-lighten-1': '#9AC8E2',
    tertiary: '#4C8C7A',
    'on-tertiary': '#FFFFFF',
    'tertiary-container': '#CDEEE0',
    'on-tertiary-container': '#04281C',
    error: '#B3261E',
    'on-error': '#FFFFFF',
    'error-container': '#F9DEDC',
    'on-error-container': '#410E0B',
    info: '#00639B',
    'on-info': '#FFFFFF',
    success: '#3F6832',
    'on-success': '#FFFFFF',
    warning: '#7D5700',
    'on-warning': '#FFFFFF',
  },
}

const dark = {
  dark: true,
  colors: {
    background: '#0F1511',
    'on-background': '#DFE4DF',
    surface: '#171D19',
    'on-surface': '#DFE4DF',
    'surface-variant': '#404943',
    'on-surface-variant': '#BFC9C2',
    'surface-bright': '#353B37',
    'surface-light': '#222824',
    'surface-dim': '#0F1511',
    'surface-container-lowest': '#0A100C',
    'surface-container-low': '#171D19',
    'surface-container': '#1B211D',
    'surface-container-high': '#262C28',
    'surface-container-highest': '#303632',
    'inverse-surface': '#DFE4DF',
    'inverse-on-surface': '#2E312F',
    outline: '#89938C',
    'outline-variant': '#404943',
    primary: '#8FD3AA',
    'on-primary': '#00391F',
    'primary-container': '#00522F',
    'on-primary-container': '#AAF2C4',
    'primary-darken-1': '#79C99E',
    'primary-lighten-1': '#AAF2C4',
    secondary: '#9AC8E2',
    'on-secondary': '#0B3446',
    'secondary-container': '#2F4A57',
    'on-secondary-container': '#CDE7F5',
    'secondary-lighten-1': '#B6D9EC',
    tertiary: '#85D6B4',
    'on-tertiary': '#003825',
    'tertiary-container': '#2A5A44',
    'on-tertiary-container': '#C8F0DA',
    error: '#F2B8B5',
    'on-error': '#601410',
    'error-container': '#8C1D18',
    'on-error-container': '#F9DEDC',
    info: '#95CCFF',
    'on-info': '#003353',
    success: '#A5D394',
    'on-success': '#11380A',
    warning: '#F5BF48',
    'on-warning': '#412D00',
  },
}

/**
 * Apply `primaryColor` / `backgroundColor` from config.json.
 *
 * With the built-in green nothing changes (the hand-tuned palette above is kept
 * verbatim). Any other primary derives its roles, plus two accent hues and a
 * matching on-background, so the whole site follows the configured colour.
 */
function themeWithConfig(base, dark) {
  const primary = normalizeHex(siteConfig.primaryColor || '#6BBF8A')
  const colors = { ...base.colors }

  if (!isDefaultPrimary(primary)) {
    Object.assign(colors, primaryRoles(primary, dark), accentRoles(primary, dark))
  }

  const background = dark
    ? siteConfig.backgroundColorDark || ''
    : siteConfig.backgroundColor || ''
  if (background) {
    const bg = normalizeHex(background, colors.background)
    colors.background = bg
    colors['on-background'] = readableOn(bg, { darkTint: 0.88 })
    colors['surface-dim'] = bg
  }

  return { ...base, colors }
}

export default createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'light',
    themes: { light: themeWithConfig(light, false), dark: themeWithConfig(dark, true) },
  },
  defaults: {
    VBtn: { rounded: 'lg' },
    VCard: { rounded: 'xl' },
    VTextField: { variant: 'outlined', density: 'comfortable', color: 'primary' },
    VSelect: { variant: 'outlined', density: 'comfortable', color: 'primary' },
    VTextarea: { variant: 'outlined', density: 'comfortable', color: 'primary' },
    VChip: { rounded: 'lg' },
    VDialog: { rounded: 'xl' },
    VMenu: { rounded: 'lg' },
    VSnackbar: { rounded: 'lg' },
    VListItem: { rounded: 'lg' },
    VAvatar: { rounded: 'circle' },
    VProgressLinear: { rounded: true },
    VTab: { rounded: 'lg' },
  },
  display: {
    mobileBreakpoint: 'md',
    thresholds: { xs: 0, sm: 600, md: 960, lg: 1280, xl: 1920 },
  },
})
