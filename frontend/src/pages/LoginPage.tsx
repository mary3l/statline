import { Alert, Box, Button, TextField } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useLogin, useMe } from '../api/queries';
import { display, tokens } from '../theme';

export function LoginPage() {
  const { data: user } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/players';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (user) return <Navigate to={from} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => navigate(from, { replace: true }) });
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: tokens.nav, p: 2 }}>
      <Box
        component="form"
        onSubmit={submit}
        noValidate
        sx={{ width: '100%', maxWidth: 380, bgcolor: tokens.card, borderRadius: '16px', p: { xs: 3, sm: 4 }, display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={tokens.ball} strokeWidth="1.6">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2v20M5.5 4.5c3 3.5 3 11.5 0 15M18.5 4.5c-3 3.5-3 11.5 0 15" />
          </svg>
          <Box component="span" sx={{ fontFamily: display, fontSize: 28, fontWeight: 700, letterSpacing: '.04em' }}>STATLINE</Box>
        </Box>
        <Box>
          <Box component="h1" sx={{ m: 0, fontSize: 20, fontWeight: 600 }}>Sign in to the league office</Box>
          <Box component="p" sx={{ m: '6px 0 0', fontSize: 14, color: tokens.muted }}>
            Player records are private. Box scores and standings are open to everyone.
          </Box>
        </Box>
        {login.error && <Alert severity="error">{login.error.message}</Alert>}
        <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Button type="submit" variant="contained" disabled={login.isPending || !email || !password}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
        <Box component={Link} to="/games" sx={{ fontSize: 14, textAlign: 'center' }}>
          Continue to box scores without signing in
        </Box>
      </Box>
    </Box>
  );
}
