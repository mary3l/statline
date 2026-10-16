import { createTheme } from '@mui/material/styles';

/** Office-page palette from the prototype (README §10). */
export const tokens = {
  ink: '#15171C',
  muted: '#5B6270',
  page: '#F3F1EC',
  card: '#FFFFFF',
  border: '#E2DED6',
  row: '#ECE8E0',
  input: '#CFC9BE',
  home: '#B5480E',
  homeDark: '#7E300A',
  away: '#1D4E89',
  negative: '#8A3B0A',
  avatar: '#F3E9D6',
  court: '#FBF6EC',
  courtLine: '#C8BFAE',
  nav: '#15171C',
  navActive: '#2A2E37',
  navText: '#C9CDD4',
  ball: '#E8742A',
} as const;

export const statusColors = {
  available: { bg: '#E3ECF7', fg: '#1D4E89', label: 'Available' },
  injured: { bg: '#FBE4D3', fg: '#8A3B0A', label: 'Injured' },
  suspended: { bg: '#E9E6E0', fg: '#3F3F46', label: 'Suspended' },
} as const;

export const display = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const body = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: tokens.home, dark: tokens.homeDark, contrastText: '#FFFFFF' },
    secondary: { main: tokens.away, contrastText: '#FFFFFF' },
    error: { main: tokens.negative },
    background: { default: tokens.page, paper: tokens.card },
    text: { primary: tokens.ink, secondary: tokens.muted },
    divider: tokens.border,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: body,
    h1: { fontFamily: display, fontWeight: 700, fontSize: '2.75rem', lineHeight: 1 },
    h2: { fontFamily: body, fontWeight: 600, fontSize: '0.9375rem' },
    h3: { fontFamily: body, fontWeight: 600, fontSize: '0.8125rem' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: tokens.page },
        a: { color: tokens.home },
        'a:hover': { color: tokens.homeDark },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 44, borderRadius: 10, paddingInline: 18 } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { backgroundColor: tokens.card, borderRadius: 10, minHeight: 44 },
        notchedOutline: { borderColor: tokens.input },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: 14 } } },
    // Labels sit above the field (as in the prototype), so an empty filter can show its "All" option.
    MuiTextField: { defaultProps: { slotProps: { inputLabel: { shrink: true } } } },
    MuiSelect: { defaultProps: { displayEmpty: true } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 44 } } },
  },
});
