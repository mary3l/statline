import { Alert, Box, Button } from '@mui/material';
import { useRef } from 'react';
import type { PlayerProfile } from '../api/types';
import { useRemoveBirthCert, useRemovePhoto, useUploadBirthCert, useUploadPhoto, useVerifyBirthCert } from '../api/uploads';
import { formatDate, formatDay } from '../lib/format';
import { display, tokens } from '../theme';

/** A hidden file input opened by a normal button (keeps the button styling and keyboard behaviour). */
function FilePicker({ label, accept, onFile, disabled }: { label: string; accept: string; onFile: (f: File) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="small" variant="outlined" onClick={() => ref.current?.click()} disabled={disabled} sx={{ minHeight: 36 }}>
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}

export function PlayerPhoto({ p, canEdit }: { p: PlayerProfile; canEdit: boolean }) {
  const upload = useUploadPhoto(p.id);
  const remove = useRemovePhoto(p.id);
  const name = `${p.firstName} ${p.lastName}`;
  const error = upload.error ?? remove.error;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, width: 132 }}>
      {p.photoVersion ? (
        <Box component="img" src={`/api/players/${p.id}/photo?v=${p.photoVersion}`} alt={name} sx={{ width: 120, height: 120, borderRadius: '16px', objectFit: 'cover', bgcolor: tokens.avatar }} />
      ) : (
        <Box
          role="img"
          aria-label={`${name}: no photo yet`}
          sx={{ width: 120, height: 120, borderRadius: '16px', bgcolor: tokens.avatar, color: tokens.homeDark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: display, fontSize: 44, fontWeight: 700 }}
        >
          {p.firstName[0]}{p.lastName.split(' ').slice(-1)[0]?.[0]}
        </Box>
      )}
      {canEdit && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}>
          <FilePicker label={upload.isPending ? 'Uploading…' : p.photoVersion ? 'Change photo' : 'Add photo'} accept="image/jpeg,image/png,image/webp" onFile={(f) => upload.mutate(f)} disabled={upload.isPending} />
          {p.photoVersion && (
            <Button size="small" color="error" onClick={() => window.confirm(`Remove ${name}'s photo?`) && remove.mutate(undefined)} sx={{ minHeight: 32 }}>
              Remove
            </Button>
          )}
        </Box>
      )}
      {error && <Box role="alert" sx={{ fontSize: 12, color: tokens.negative, textAlign: 'center' }}>{error.message}</Box>}
    </Box>
  );
}

export function BirthCertificate({ p, canEdit }: { p: PlayerProfile; canEdit: boolean }) {
  const upload = useUploadBirthCert(p.id);
  const remove = useRemoveBirthCert(p.id);
  const verify = useVerifyBirthCert(p.id);
  const error = upload.error ?? remove.error ?? verify.error;
  const status = p.birthCertVerifiedOn ? `Verified · ${formatDay(p.birthCertVerifiedOn)}` : p.birthCert ? 'Uploaded, not verified yet' : 'Not verified yet';
  return (
    <Box sx={{ mt: 1.5, p: '10px 12px', borderRadius: '10px', bgcolor: tokens.page, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <span>Birth certificate</span>
        <strong>{status}</strong>
      </Box>
      {canEdit && (
        <>
          {p.birthCert && (
            <Box sx={{ color: tokens.muted, fontSize: 12 }}>
              {p.birthCert.type === 'application/pdf' ? 'PDF' : 'Image'} uploaded {formatDate(p.birthCert.uploadedAt)}. Only organizers and admins can open it.
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {p.birthCert && (
              <Button size="small" variant="outlined" component="a" href={`/api/players/${p.id}/birth-certificate`} target="_blank" rel="noopener" sx={{ minHeight: 36 }}>
                View
              </Button>
            )}
            <FilePicker
              label={upload.isPending ? 'Uploading…' : p.birthCert ? 'Replace' : 'Upload'}
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onFile={(f) => upload.mutate(f)}
              disabled={upload.isPending}
            />
            {p.birthCert && !p.birthCertVerifiedOn && (
              <Button size="small" variant="contained" onClick={() => verify.mutate(true)} disabled={verify.isPending} sx={{ minHeight: 36 }}>
                Mark verified
              </Button>
            )}
            {p.birthCertVerifiedOn && (
              <Button size="small" onClick={() => verify.mutate(false)} disabled={verify.isPending} sx={{ minHeight: 36 }}>
                Unverify
              </Button>
            )}
            {p.birthCert && (
              <Button size="small" color="error" onClick={() => window.confirm('Remove the uploaded birth certificate? Its verification is cleared too.') && remove.mutate(undefined)} sx={{ minHeight: 36 }}>
                Remove
              </Button>
            )}
          </Box>
          {!p.birthCert && <Box sx={{ color: tokens.muted, fontSize: 12 }}>Upload a scan or photo (PDF, JPG or PNG), check it against the birthdate above, then mark it verified.</Box>}
        </>
      )}
      {error && <Alert severity="error" sx={{ py: 0 }}>{error.message}</Alert>}
    </Box>
  );
}
