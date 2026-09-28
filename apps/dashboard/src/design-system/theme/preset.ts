import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/**
 * PrimeNG preset.
 *
 * Ported from the RestaurantOS dashboard, which had already mapped the
 * Heykara navy onto Aura. Every Prime component — inputs, dialogs, tables,
 * popovers — reads its colours from here, so this file is the reason the
 * library looks like the rest of the estate rather than like Aura.
 *
 * Pair with design-system/styles/tokens.css, which holds the layout scale
 * the components themselves use.
 */
export const DashboardPreset = definePreset(Aura, {
  primitive: {
    navy: {
      50: '#f2f2fb', 100: '#e1e2f5', 200: '#c2c4ec', 300: '#9194d9', 400: '#5a5ec0',
      500: '#2a2e9e', 600: '#0f1283', 700: '#000268', 800: '#000255', 900: '#000142', 950: '#00012b'
    },
    borderRadius: { none: '0', xs: '6px', sm: '8px', md: '12px', lg: '16px', xl: '20px' }
  },
  semantic: {
    primary: {
      50: '{navy.50}', 100: '{navy.100}', 200: '{navy.200}', 300: '{navy.300}', 400: '{navy.400}',
      500: '{navy.500}', 600: '{navy.600}', 700: '{navy.700}', 800: '{navy.800}', 900: '{navy.900}', 950: '{navy.950}'
    },
    disabledOpacity: '0.5',
    focusRing: { width: '0', style: 'none', color: 'transparent', offset: '0', shadow: '0 0 0 3px {primary.100}' },
    formField: {
      paddingX: '0.875rem',
      paddingY: '0.625rem',
      borderRadius: '{border.radius.md}',
      sm: { fontSize: '0.8125rem', paddingX: '0.75rem', paddingY: '0.4375rem' },
      lg: { fontSize: '1rem', paddingX: '1rem', paddingY: '0.75rem' },
      focusRing: { width: '0', style: 'none', color: 'transparent', offset: '0', shadow: '0 0 0 3px {primary.100}' }
    },
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff', 50: '#f8f9fa', 100: '#f1f3f5', 200: '#e7e9ee', 300: '#d5d8df', 400: '#a7abb6',
          500: '#6b7280', 600: '#4b5160', 700: '#444444', 800: '#262626', 900: '#101010', 950: '#0a0a0a'
        },
        primary: { color: '{primary.700}', contrastColor: '#ffffff', hoverColor: '{primary.800}', activeColor: '{primary.900}' },
        highlight: { background: '{primary.50}', focusBackground: '{primary.100}', color: '{primary.700}', focusColor: '{primary.800}' },
        text: { color: '{surface.900}', hoverColor: '{surface.950}', mutedColor: '{surface.500}', hoverMutedColor: '{surface.600}' },
        content: { background: '{surface.0}', hoverBackground: '{surface.100}', borderColor: 'rgba(0, 0, 0, 0.06)', color: '{text.color}', hoverColor: '{text.hover.color}' },
        formField: {
          background: '{surface.0}', disabledBackground: '{surface.100}', filledBackground: '{surface.50}',
          borderColor: '{surface.200}', hoverBorderColor: '{surface.300}', focusBorderColor: '{primary.700}', invalidBorderColor: '#eb445a',
          color: '{surface.900}', disabledColor: '{surface.500}', placeholderColor: '{surface.500}', floatLabelColor: '{surface.500}',
          iconColor: '{surface.500}', shadow: 'none'
        }
      },
      dark: {
        surface: {
          0: '#ffffff', 50: '#f4f5fb', 100: '#e1e3ec', 200: '#c6c8d6', 300: '#a3a6b8', 400: '#8b8fa3',
          500: '#5d6178', 600: '#3a3d52', 700: '#2a2d40', 800: '#1f2233', 900: '#161827', 950: '#0d0e1a'
        },
        primary: { color: '#a5a7ff', contrastColor: '#0b0c2a', hoverColor: '#b9bbff', activeColor: '#cdceff' },
        highlight: { background: 'rgba(165, 167, 255, 0.14)', focusBackground: 'rgba(165, 167, 255, 0.22)', color: '#e1e2ff', focusColor: '#ffffff' },
        focusRing: { shadow: '0 0 0 3px rgba(165, 167, 255, 0.28)' },
        text: { color: '{surface.50}', hoverColor: '{surface.0}', mutedColor: '{surface.400}', hoverMutedColor: '{surface.200}' },
        content: { background: '{surface.900}', hoverBackground: '{surface.800}', borderColor: 'rgba(255, 255, 255, 0.08)', color: '{text.color}', hoverColor: '{text.hover.color}' },
        formField: {
          background: '{surface.950}', disabledBackground: '{surface.800}', filledBackground: '{surface.800}',
          borderColor: '{surface.700}', hoverBorderColor: '{surface.600}', focusBorderColor: '{primary.color}', invalidBorderColor: '#ff6b7f',
          color: '{surface.50}', disabledColor: '{surface.400}', placeholderColor: '{surface.400}', floatLabelColor: '{surface.400}',
          iconColor: '{surface.400}', shadow: 'none'
        }
      }
    }
  },
  components: {
    button: {
      root: {
        borderRadius: '999px', gap: '0.5rem', paddingX: '1.125rem', paddingY: '0.625rem',
        label: { fontWeight: '600' },
        sm: { fontSize: '0.8125rem', paddingX: '0.875rem', paddingY: '0.4375rem' },
        lg: { fontSize: '1rem', paddingX: '1.5rem', paddingY: '0.875rem' }
      }
    },
    card: {
      root: { borderRadius: '20px', shadow: '0 4px 16px rgba(0, 0, 0, 0.04)' },
      body: { padding: '1.5rem', gap: '1rem' },
      title: { fontSize: '0.9375rem', fontWeight: '700' },
      subtitle: { color: '{text.muted.color}' }
    },
    datatable: {
      headerCell: { padding: '0.75rem 1.5rem', borderColor: '{content.border.color}', color: '{text.muted.color}' },
      columnTitle: { fontWeight: '600' },
      bodyCell: { padding: '0.875rem 1.5rem', borderColor: '{content.border.color}' },
      header: { padding: '1rem 1.5rem', borderColor: '{content.border.color}', borderWidth: '0 0 1px 0' },
      colorScheme: {
        light: { headerCell: { background: '{surface.50}' }, row: { hoverBackground: 'rgba(0, 2, 104, 0.03)', selectedBackground: '{primary.50}' } },
        dark: { headerCell: { background: '{surface.950}' }, row: { hoverBackground: 'rgba(165, 167, 255, 0.05)', selectedBackground: 'rgba(165, 167, 255, 0.10)' } }
      }
    },
    dialog: {
      root: { borderRadius: '24px', shadow: '0 10px 24px rgba(0, 0, 0, 0.08)' },
      header: { padding: '1.5rem 1.5rem 1rem', gap: '1rem' },
      title: { fontSize: '1.125rem', fontWeight: '700' },
      content: { padding: '0 1.5rem 1.25rem' },
      footer: { padding: '1rem 1.5rem', gap: '0.5rem' }
    },
    drawer: {
      header: { padding: '1.5rem' },
      title: { fontSize: '1.125rem', fontWeight: '700' },
      content: { padding: '0 1.5rem 1.5rem' },
      footer: { padding: '1rem 1.5rem' }
    },
    selectbutton: { root: { borderRadius: '999px' } },
    togglebutton: { root: { borderRadius: '999px', padding: '0.4375rem 0.875rem', fontWeight: '600' }, content: { borderRadius: '999px' } },
    tag: { root: { borderRadius: '999px', fontSize: '0.6875rem', fontWeight: '600', padding: '0.25rem 0.625rem', gap: '0.375rem' } },
    paginator: { navButton: { borderRadius: '999px' } },
    stepper: { stepNumber: { borderRadius: '999px', fontWeight: '700' }, stepTitle: { fontWeight: '600' } },
    avatar: { root: { fontSize: '0.75rem' } }
  }
});
