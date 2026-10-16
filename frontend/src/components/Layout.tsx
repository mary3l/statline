import { Box, Button } from '@mui/material';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../api/queries';
import { display, tokens } from '../theme';

const LINKS = [
  { to: '/record', label: 'Live scorer', signedIn: true },
  { to: '/players', label: 'Players' },
  { to: '/games', label: 'Box scores' },
  { to: '/leaders', label: 'Leaders & standings' },
  { to: '/lineups', label: 'Lineups' },
  { to: '/matchup', label: 'Season matchup' },
  { to: '/admin', label: 'League office', office: true },
];

function Logo() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, pb: { xs: 0, md: 2.75 }, pt: 0.5 }}>
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={tokens.ball} strokeWidth="1.6">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2v20M5.5 4.5c3 3.5 3 11.5 0 15M18.5 4.5c-3 3.5-3 11.5 0 15" />
      </svg>
      <Box component="span" sx={{ fontFamily: display, fontSize: 26, fontWeight: 700, letterSpacing: '.04em' }}>
        STATLINE
      </Box>
    </Box>
  );
}

const ROLE_LABEL = { admin: 'Admin', organizer: 'League organizer', scorer: 'Scorer' } as const;

export function Layout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: { xs: 'column', md: 'row' } }}>
      <Box
        component="nav"
        aria-label="Main"
        sx={{
          flex: { md: '0 0 236px' },
          bgcolor: tokens.nav,
          color: tokens.page,
          p: { xs: '14px 12px', md: '24px 14px' },
          display: 'flex',
          flexDirection: { xs: 'row', md: 'column' },
          flexWrap: { xs: 'wrap', md: 'nowrap' },
          alignItems: { xs: 'center', md: 'stretch' },
          gap: 0.5,
          position: { md: 'sticky' },
          top: 0,
          height: { md: '100vh' },
          boxSizing: 'border-box',
        }}
      >
        <Logo />
        <Box sx={{ display: 'flex', flexDirection: { xs: 'row', md: 'column' }, gap: 0.5, overflowX: 'auto', order: { xs: 3, md: 0 }, width: { xs: '100%', md: 'auto' } }}>
          {LINKS.filter((l) => (!l.signedIn || user) && (!l.office || user?.role === 'admin' || user?.role === 'organizer')).map((l) => (
            <Box
              key={l.to}
              component={NavLink}
              to={l.to}
              sx={{
                display: 'flex',
                alignItems: 'center',
                minHeight: 44,
                px: 1.5,
                borderRadius: '8px',
                color: tokens.navText,
                textDecoration: 'none',
                fontSize: 14,
                whiteSpace: 'nowrap',
                '&:hover': { color: '#FFFFFF', bgcolor: '#1F232B' },
                '&.active': { color: '#FFFFFF', bgcolor: tokens.navActive, fontWeight: 600 },
                '&:focus-visible': { outline: `2px solid ${tokens.ball}`, outlineOffset: 2 },
              }}
            >
              {l.label}
            </Box>
          ))}
        </Box>

        <Box sx={{ mt: { md: 'auto' }, ml: { xs: 'auto', md: 0 }, px: { md: 1.25 }, pt: { md: 2 }, borderTop: { md: '1px solid #2A2E37' }, display: 'flex', flexDirection: { xs: 'row', md: 'column' }, alignItems: { xs: 'center', md: 'flex-start' }, gap: 1 }}>
          {user ? (
            <>
              <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexDirection: 'column', fontSize: 13 }}>
                <Box component="span" sx={{ color: '#FFFFFF', fontWeight: 600 }}>{user.name}</Box>
                <Box component="span" sx={{ color: tokens.navText, fontSize: 12 }}>{ROLE_LABEL[user.role]}</Box>
              </Box>
              <Button
                size="small"
                variant="outlined"
                onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/games') })}
                sx={{ color: tokens.navText, borderColor: '#3A3F4A', minHeight: 36, '&:hover': { borderColor: tokens.navText } }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Button
              size="small"
              variant="outlined"
              onClick={() => navigate('/login', { state: { from: location.pathname } })}
              sx={{ color: '#FFFFFF', borderColor: '#3A3F4A', minHeight: 36 }}
            >
              Sign in
            </Button>
          )}
        </Box>
      </Box>

      <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: '24px 16px 48px', sm: '32px clamp(16px, 3vw, 40px) 56px' } }}>
        <Box sx={{ maxWidth: 1180, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
