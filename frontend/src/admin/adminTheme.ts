import { createTheme } from '@mui/material/styles';

const netflixSans = '"Netflix Sans Local", "Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

const adminTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#e50914', light: '#ff5962', dark: '#b20710' },
    background: { default: '#030c16', paper: '#081523' },
    text: { primary: '#ffffff', secondary: 'rgba(255,255,255,.68)' },
    divider: 'rgba(150,182,212,.16)',
  },
  typography: {
    fontFamily: netflixSans,
    button: { textTransform: 'none', fontWeight: 700 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontFamily: netflixSans },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          background: 'rgba(6,17,29,.97)',
          border: '1px solid rgba(150,182,212,.30)',
          borderRadius: 14,
          backdropFilter: 'blur(22px) saturate(150%)',
          boxShadow: '0 24px 60px rgba(0,0,0,.52)',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          background: 'rgba(6,17,29,.97)',
          border: '1px solid rgba(150,182,212,.30)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(0,0,0,.52)',
        },
        list: { padding: 6 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontSize: 13.5,
          color: 'rgba(255,255,255,.78)',
          '&:hover': { backgroundColor: 'rgba(255,255,255,.06)', color: '#fff' },
          '&.Mui-selected': {
            backgroundColor: 'rgba(229,9,20,.13)',
            color: '#fff',
            '&:hover': { backgroundColor: 'rgba(229,9,20,.18)' },
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          color: '#fff',
          background: '#081523',
          border: '1px solid rgba(150,182,212,.30)',
          borderRadius: 18,
          boxShadow: '0 28px 80px rgba(0,0,0,.58)',
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontWeight: 750, letterSpacing: '-.02em' } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          background: '#102033',
          color: '#fff',
          border: '1px solid rgba(150,182,212,.24)',
          borderRadius: 8,
          fontSize: 11.5,
          boxShadow: '0 10px 28px rgba(0,0,0,.4)',
        },
        arrow: { color: '#102033' },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 9, minHeight: 40, boxShadow: 'none' },
        containedPrimary: {
          background: '#e50914',
          '&:hover': { background: '#f0141f', boxShadow: 'none' },
        },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          background: 'rgba(255,255,255,.035)',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(146,174,198,.25)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(182,204,222,.46)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(229,9,20,.82)', borderWidth: 1 },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: 'rgba(255,255,255,.52)',
          '&.Mui-focused': { color: 'rgba(255,255,255,.84)' },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: 'rgba(154,181,203,.12)' },
        head: {
          color: 'rgba(255,255,255,.55)',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '.055em',
          textTransform: 'uppercase',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          background: 'rgba(255,255,255,.06)',
          border: '1px solid rgba(157,183,205,.15)',
        },
      },
    },
  },
});

export default adminTheme;
