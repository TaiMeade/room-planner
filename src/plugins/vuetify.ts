import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'

/**
 * One theme, deliberately: dark ink chrome wrapped around a light paper canvas.
 *
 * A drafting table under a lamp — the tools sit in shadow and the drawing is the
 * lit thing. A light/dark toggle would undo the whole idea, since the paper has
 * to stay paper either way.
 *
 * Blueprint blue is the only accent, and it is reserved for things that are
 * *measured*: selection, dimension strings, snap indicators. Nothing decorative
 * gets to be blue.
 */
export default createVuetify({
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'drafting',
    themes: {
      drafting: {
        dark: true,
        colors: {
          background: '#1B2327',
          surface: '#232D33',
          'surface-bright': '#2B363D',
          'surface-light': '#2B363D',
          'surface-variant': '#33414A',
          'on-surface-variant': '#C4D0D6',
          primary: '#5A9FC9',
          'primary-darken-1': '#3E7CA6',
          secondary: '#8FA3AD',
          accent: '#D9A05B',
          error: '#DC7A66',
          info: '#5A9FC9',
          success: '#84AE8F',
          warning: '#D9A05B',
          'on-background': '#E8ECEC',
          'on-surface': '#E8ECEC',
          'on-primary': '#0F1518',
        },
        variables: {
          'border-color': '#7C8F99',
          'border-opacity': 0.22,
          'high-emphasis-opacity': 0.96,
          'medium-emphasis-opacity': 0.72,
        },
      },
    },
  },
  defaults: {
    global: {
      ripple: false,
    },
    VBtn: { rounded: 'md', elevation: 0, class: 'text-none', variant: 'text' },
    VCard: { elevation: 0, rounded: 'md', color: 'surface' },
    VTextField: {
      variant: 'outlined',
      density: 'compact',
      color: 'primary',
      hideDetails: 'auto',
    },
    VTextarea: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VSlider: { color: 'primary', density: 'compact', hideDetails: true, trackSize: 2 },
    VSwitch: { color: 'primary', density: 'compact', hideDetails: true, inset: true },
    VChip: { rounded: 'sm', size: 'small', variant: 'tonal' },
    VDialog: { maxWidth: 560 },
    VTooltip: { openDelay: 400 },
    VDivider: { color: 'surface-variant' },
    VList: { density: 'compact', bgColor: 'transparent' },
    VExpansionPanels: { variant: 'accordion', flat: true },
  },
})
