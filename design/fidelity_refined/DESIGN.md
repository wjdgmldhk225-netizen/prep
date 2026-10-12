---
name: Fidelity Refined
colors:
  surface: '#15130e'
  surface-dim: '#15130e'
  surface-bright: '#3c3933'
  surface-container-lowest: '#100e09'
  surface-container-low: '#1d1b16'
  surface-container: '#221f1a'
  surface-container-high: '#2c2a24'
  surface-container-highest: '#37342e'
  on-surface: '#e8e2d9'
  on-surface-variant: '#d1c4bd'
  inverse-surface: '#e8e2d9'
  inverse-on-surface: '#33302a'
  outline: '#9a8e88'
  outline-variant: '#4e4540'
  surface-tint: '#d6c3b7'
  primary: '#d6c3b7'
  on-primary: '#3a2e26'
  primary-container: '#9f8d83'
  on-primary-container: '#332720'
  inverse-primary: '#6a5b52'
  secondary: '#d0c4be'
  on-secondary: '#362f2b'
  secondary-container: '#4d4541'
  on-secondary-container: '#beb3ad'
  tertiary: '#dec393'
  on-tertiary: '#3e2e0a'
  tertiary-container: '#8a744a'
  on-tertiary-container: '#090400'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#f3dfd2'
  primary-fixed-dim: '#d6c3b7'
  on-primary-fixed: '#241912'
  on-primary-fixed-variant: '#52443b'
  secondary-fixed: '#ece0da'
  secondary-fixed-dim: '#d0c4be'
  on-secondary-fixed: '#201a17'
  on-secondary-fixed-variant: '#4d4541'
  tertiary-fixed: '#fbdfac'
  tertiary-fixed-dim: '#dec393'
  on-tertiary-fixed: '#261900'
  on-tertiary-fixed-variant: '#56441e'
  background: '#15130e'
  on-background: '#e8e2d9'
  surface-variant: '#37342e'
typography:
  headline-lg:
    fontFamily: EB Garamond
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  body-md:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: Manrope
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

# Design System

## Brand & Style
The design system embraces a restrained, editorial aesthetic ("fidelity") characterized by sophisticated typography and a calm, earthy dark-mode color palette. It blends modern functionality with a literary sensibility, utilizing EB Garamond for expressive headlines and Manrope for clean, legible body text. The overall emotional tone is trustworthy, grounded, and refined, ideal for content-heavy applications and professional platforms.

## Colors
The color system is built upon a muted, earthy palette tailored for a dark color mode that emphasizes calm sophistication. 
- **Primary (`#84746a`)**: A warm, grey-brown taupe used for key interactive elements, primary actions, and focal points.
- **Secondary (`#7e7570`)**: A balanced, neutral taupe supporting secondary actions and structural highlights.
- **Tertiary (`#342503`)**: A deep, rich dark brown providing strong contrast and accent capabilities.
- **Neutral (`#ded8cf`)**: Used for text, borders, and surface tones to ensure a harmonious, low-contrast reading experience against dark surfaces.

## Typography
Typography bridges editorial elegance with modern readability. **EB Garamond** is chosen for headlines, imparting a classic, literary tone. **Manrope** serves as the body and label font, offering exceptional legibility and a contemporary geometric structure across varying screen sizes.

## Layout & Spacing
A balanced, consistent spacing rhythm supports the editorial layout. Using a standard spacing scale, elements maintain comfortable breathing room, preventing visual clutter and reinforcing the refined, minimalist character of the system.

## Elevation & Depth
Elevation is achieved primarily through subtle tonal layering and low-contrast outlines rather than heavy drop shadows. This maintains a flat, contemporary aesthetic that respects the earthy, understated palette in a dark mode environment.

## Shapes
The shape language uses moderate roundedness (`2`). UI elements feature a friendly yet polished curve (0.5rem base radius), softening the overall aesthetic while maintaining a structured, professional appearance.

## Components
- **Buttons:** Solid primary buttons utilize the `#84746a` taupe with moderately rounded corners (`2`), offering clear affordance without aggression.
- **Input Fields:** Clean borders in neutral tones with subtle focus states matching the primary palette.
- **Cards:** Surface containers rely on soft neutral backgrounds and gentle rounded corners to group related information harmoniously within a dark interface.