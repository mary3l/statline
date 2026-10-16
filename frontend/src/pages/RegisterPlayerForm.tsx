import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, TextField } from '@mui/material';
import { useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { useRegisterPlayer } from '../api/queries';
import type { Meta } from '../api/types';
import { Card } from '../components/ui';
import { ageGroupFor, POSITION_LABEL } from '../lib/format';
import { tokens } from '../theme';

const optionalInt = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && +v >= min && +v <= max), `${label} must be ${min}–${max}.`);

const schema = z
  .object({
    firstName: z.string().trim().min(1, 'Add a first name.').max(60),
    lastName: z.string().trim().min(1, 'Add a last name.').max(60),
    birthdate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Add a birthdate.')
      .refine((d) => d >= '1930-01-01' && d <= new Date().toISOString().slice(0, 10), 'Enter a real birthdate in the past.'),
    gender: z.enum(['F', 'M']),
    position: z.enum(['PG', 'SG', 'SF', 'PF', 'C']),
    heightCm: optionalInt(100, 250, 'Height'),
    weightKg: optionalInt(20, 200, 'Weight'),
    teamId: z.string(),
    jersey: z
      .string()
      .trim()
      .refine((v) => v === '' || /^(0|00|[1-9]\d?)$/.test(v), 'Jersey numbers are 0, 00 or 1–99.'),
    leagueIds: z.array(z.number()),
  })
  .refine((v) => !v.teamId || v.jersey !== '', { message: 'Add the jersey number worn for this team.', path: ['jersey'] });

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = {
  firstName: '',
  lastName: '',
  birthdate: '',
  gender: 'F',
  position: 'PG',
  heightCm: '',
  weightKg: '',
  teamId: '',
  jersey: '',
  leagueIds: [],
};

export function RegisterPlayerForm({
  meta,
  seasonYear,
  onDone,
}: {
  meta: Meta;
  seasonYear: number;
  onDone: (player: { id: number; name: string }) => void;
}) {
  const register = useRegisterPlayer();
  const { control, handleSubmit, watch, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const autoLeague = useRef<number | null>(null);
  const birthdate = watch('birthdate');
  const teamId = watch('teamId');
  const leagueIds = watch('leagueIds');
  const team = meta.teams.find((t) => String(t.id) === teamId);
  const group = birthdate ? ageGroupFor(birthdate, seasonYear) : null;

  const submit = handleSubmit((v) => {
    register.mutate(
      {
        firstName: v.firstName,
        lastName: v.lastName,
        birthdate: v.birthdate,
        gender: v.gender,
        position: v.position,
        heightCm: v.heightCm ? Number(v.heightCm) : null,
        weightKg: v.weightKg ? Number(v.weightKg) : null,
        teamId: v.teamId ? Number(v.teamId) : null,
        jersey: v.teamId ? v.jersey : null,
        leagueIds: v.leagueIds,
      },
      { onSuccess: ({ id }) => onDone({ id, name: `${v.firstName} ${v.lastName}` }) },
    );
  });

  const field = (name: keyof FormValues) => ({
    error: !!formState.errors[name],
    helperText: formState.errors[name]?.message as string | undefined,
  });

  const serverError = register.error;
  const duplicateId = (serverError as { body?: { duplicateId?: number } } | null)?.body?.duplicateId;

  return (
    <Card aria-labelledby="register-heading" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box component="h2" id="register-heading" sx={{ m: 0, fontSize: 17, fontWeight: 600 }}>
        Register a player
      </Box>
      <Box component="form" noValidate onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 1.75 }}>
          <Controller name="firstName" control={control} render={({ field: f }) => <TextField {...f} label="First name" placeholder="e.g. Juan" {...field('firstName')} />} />
          <Controller name="lastName" control={control} render={({ field: f }) => <TextField {...f} label="Last name" placeholder="e.g. Dela Cruz" {...field('lastName')} />} />
          <Controller
            name="birthdate"
            control={control}
            render={({ field: f }) => (
              <TextField
                {...f}
                type="date"
                label="Birthdate"
                slotProps={{ inputLabel: { shrink: true } }}
                {...field('birthdate')}
                helperText={formState.errors.birthdate?.message ?? (group ? `${group.group} · reaches ${group.age} in ${seasonYear}` : ' ')}
              />
            )}
          />
          <Controller
            name="gender"
            control={control}
            render={({ field: f }) => (
              <TextField {...f} select label="Gender">
                <MenuItem value="F">Female</MenuItem>
                <MenuItem value="M">Male</MenuItem>
              </TextField>
            )}
          />
          <Controller
            name="position"
            control={control}
            render={({ field: f }) => (
              <TextField {...f} select label="Position">
                {meta.positions.map((p) => (
                  <MenuItem key={p} value={p}>{`${p} · ${POSITION_LABEL[p]}`}</MenuItem>
                ))}
              </TextField>
            )}
          />
          <Controller name="heightCm" control={control} render={({ field: f }) => <TextField {...f} label="Height (cm)" inputMode="numeric" {...field('heightCm')} />} />
          <Controller name="weightKg" control={control} render={({ field: f }) => <TextField {...f} label="Weight (kg)" inputMode="numeric" {...field('weightKg')} />} />
          <Controller
            name="teamId"
            control={control}
            render={({ field: f }) => (
              <TextField
                {...f}
                select
                label="Current team"
                onChange={(e) => {
                  f.onChange(e);
                  // The team's league is ticked for the user; switching teams un-ticks the one we added before.
                  const t = meta.teams.find((x) => String(x.id) === e.target.value);
                  let next = autoLeague.current === null ? leagueIds : leagueIds.filter((x) => x !== autoLeague.current);
                  autoLeague.current = null;
                  if (t && !next.includes(t.leagueId)) {
                    next = [...next, t.leagueId];
                    autoLeague.current = t.leagueId;
                  }
                  setValue('leagueIds', next);
                }}
              >
                <MenuItem value="">Free agent (no team)</MenuItem>
                {meta.leagues.flatMap((l) => {
                  const teams = meta.teams.filter((t) => t.leagueId === l.id);
                  if (!teams.length) return [];
                  return [
                    <MenuItem key={`l${l.id}`} disabled sx={{ fontSize: 12, opacity: '1 !important', color: tokens.muted }}>
                      {l.name}
                    </MenuItem>,
                    ...teams.map((t) => (
                      <MenuItem key={t.id} value={String(t.id)} sx={{ pl: 3 }}>
                        {t.name}
                      </MenuItem>
                    )),
                  ];
                })}
              </TextField>
            )}
          />
          <Controller
            name="jersey"
            control={control}
            render={({ field: f }) => (
              <TextField {...f} label="Jersey #" inputMode="numeric" disabled={!teamId} {...field('jersey')} />
            )}
          />
        </Box>

        <Box component="fieldset" sx={{ border: 'none', m: 0, p: 0 }}>
          <Box component="legend" sx={{ fontSize: 13, fontWeight: 500, pb: 1 }}>
            Leagues played
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.25 }}>
            {meta.leagues.map((l) => {
              const locked = team?.leagueId === l.id;
              return (
                <FormControlLabel
                  key={l.id}
                  label={l.name}
                  disabled={locked}
                  control={
                    <Checkbox
                      checked={leagueIds.includes(l.id)}
                      onChange={(e) =>
                        setValue('leagueIds', e.target.checked ? [...leagueIds, l.id] : leagueIds.filter((x) => x !== l.id))
                      }
                    />
                  }
                />
              );
            })}
          </Box>
        </Box>

        {serverError && (
          <Alert severity="error">
            {serverError.message}
            {duplicateId && (
              <>
                {' '}
                <Link to={`/players/${duplicateId}`}>Open the existing record</Link>
              </>
            )}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
          <Button type="submit" variant="contained" disabled={register.isPending}>
            {register.isPending ? 'Saving…' : 'Save player'}
          </Button>
          <Box component="span" sx={{ fontSize: 13, color: tokens.muted }}>
            Age group is filled in from the birthdate. Team eligibility is checked when you save.
          </Box>
        </Box>
      </Box>
    </Card>
  );
}
