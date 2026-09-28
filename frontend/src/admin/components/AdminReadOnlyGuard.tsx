// @ts-nocheck
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { api } from '../pages/shared';

/**
 * Keeps restricted admin pages visible while making their write controls
 * visibly read-only. Backend permission middleware remains the authority.
 */
export default function AdminReadOnlyGuard({ editPermission, children }) {
  const [state, setState] = useState({ loading: true, allowed: true });

  useEffect(() => {
    let alive = true;
    api('/api/admin/permissions/me')
      .then((data) => {
        if (!alive) return;
        const superadmin = data?.role === 'superadmin';
        setState({ loading: false, allowed: superadmin || Boolean(data?.permissions?.[editPermission]) });
      })
      .catch(() => {
        if (alive) setState({ loading: false, allowed: true });
      });
    return () => { alive = false; };
  }, [editPermission]);

  if (state.loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress sx={{ color: '#e50914' }} /></Box>;
  }

  if (state.allowed) return children;

  return (
    <Box data-testid={`read-only-${editPermission}`}>
      <Alert
        severity="info"
        sx={{ mb: 2.2, bgcolor: 'rgba(96,165,250,.08)', color: '#bfdbfe', border: '1px solid rgba(96,165,250,.18)' }}
      >
        Modalità sola lettura · Solo Superadmin può modificare questa sezione.
      </Alert>
      <Box
        sx={{
          position: 'relative',
          '& button, & input, & textarea, & [role="button"], & .MuiSwitch-root, & .MuiSelect-select': {
            pointerEvents: 'none !important',
          },
          '& button, & .MuiSwitch-root': { opacity: '.46 !important' },
          '& input, & textarea, & .MuiSelect-select': { opacity: '.72 !important' },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
