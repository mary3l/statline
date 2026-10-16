import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import type { FormEvent, ReactNode } from 'react';

/** Small modal form used by every League office editor. */
export function FormDialog({
  open,
  title,
  onClose,
  onSubmit,
  pending,
  error,
  submitLabel = 'Save',
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  pending?: boolean;
  error?: Error | null;
  submitLabel?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <Box
        component="form"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>{title}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          {children}
          {error && <Alert severity="error">{error.message}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={pending}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
