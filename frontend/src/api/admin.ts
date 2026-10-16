import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { keys } from './queries';
import type { Gender, PlayerStatus, Position, Side } from './types';

/** League office set-up calls (admins and organizers). Every change refreshes the reference data and game lists. */
function useAdminMutation<T>(fn: (body: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.meta });
      qc.invalidateQueries({ queryKey: ['games'] });
      qc.invalidateQueries({ queryKey: ['standings'] });
      qc.invalidateQueries({ queryKey: ['roster'] });
      qc.invalidateQueries({ queryKey: ['players'] });
      qc.invalidateQueries({ queryKey: ['boxscore'] });
    },
  });
}

export interface LeagueInput {
  name: string;
  level: string;
  gender: Gender | null;
  minAge: number | null;
  maxAge: number | null;
}
export interface TeamInput {
  name: string;
  shortName: string;
  color: string;
}
export interface GameInput {
  homeTeamId: number;
  awayTeamId: number;
  scheduledAt: string;
  venue: string | null;
}

export const useCreateSeason = () =>
  useAdminMutation((b: { year: number; isCurrent: boolean }) => api('/admin/seasons', { method: 'POST', body: b }));
export const useMakeCurrentSeason = () =>
  useAdminMutation((id: number) => api(`/admin/seasons/${id}`, { method: 'PATCH', body: { isCurrent: true } }));

export const useSaveLeague = () =>
  useAdminMutation(({ id, ...b }: LeagueInput & { id?: number }) =>
    id ? api(`/admin/leagues/${id}`, { method: 'PATCH', body: b }) : api('/admin/leagues', { method: 'POST', body: b }),
  );

export const useSaveTeam = () =>
  useAdminMutation(({ id, leagueId, ...b }: TeamInput & { id?: number; leagueId: number }) =>
    id ? api(`/admin/teams/${id}`, { method: 'PATCH', body: b }) : api('/admin/teams', { method: 'POST', body: { ...b, leagueId } }),
  );

export interface RosterRow {
  entryId: number;
  playerId: number;
  firstName: string;
  lastName: string;
  position: Position;
  status: PlayerStatus;
  jersey: string;
  joinedOn: string | null;
  leftOn: string | null;
}

export function useTeamRoster(teamId: number | undefined, seasonId: number | undefined) {
  return useQuery({
    queryKey: ['roster', teamId, seasonId],
    queryFn: () => api<{ season: { id: number; year: number }; players: RosterRow[] }>(`/admin/teams/${teamId}/roster`, { query: { seasonId } }),
    enabled: !!teamId,
  });
}

export const useAddToRoster = (teamId: number) =>
  useAdminMutation((b: { playerId: number; jersey: string; seasonId?: number }) => api(`/admin/teams/${teamId}/roster`, { method: 'POST', body: b }));
export const useReleaseFromRoster = () => useAdminMutation((entryId: number) => api(`/admin/roster/${entryId}`, { method: 'DELETE' }));

export const useSaveGame = () =>
  useAdminMutation(({ id, leagueId, seasonId, ...b }: GameInput & { id?: number; leagueId: number; seasonId?: number }) =>
    id ? api(`/admin/games/${id}`, { method: 'PATCH', body: b }) : api('/admin/games', { method: 'POST', body: { ...b, leagueId, seasonId } }),
  );
export const useDeleteGame = () => useAdminMutation((id: number) => api(`/admin/games/${id}`, { method: 'DELETE' }));
export const useForfeit = () =>
  useAdminMutation(({ id, forfeitedBy }: { id: number; forfeitedBy: Side | null }) =>
    api(`/admin/games/${id}/forfeit`, { method: 'POST', body: { forfeitedBy } }),
  );

/** Other games the teams already have that day (Davao time). */
export function useScheduleConflicts(teamIds: number[], day: string | undefined, excludeId?: number) {
  const ids = teamIds.filter(Boolean);
  return useQuery({
    queryKey: ['conflicts', ids, day, excludeId],
    queryFn: () =>
      api<{ games: { id: number; scheduledAt: string; homeTeamId: number; awayTeamId: number }[] }>('/admin/games/conflicts', {
        query: { teamIds: ids.join(','), day, excludeId },
      }),
    enabled: ids.length > 0 && !!day && /^\d{4}-\d{2}-\d{2}$/.test(day),
  });
}
