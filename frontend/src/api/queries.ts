import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  BoxScoreResponse,
  Game,
  Gender,
  LeadersResponse,
  LineupsResponse,
  MatchupResponse,
  Meta,
  PlayerList,
  PlayerProfile,
  PlayerStatus,
  Position,
  RecorderData,
  SessionUser,
  Side,
  StandingsResponse,
} from './types';

export const keys = {
  me: ['me'] as const,
  meta: ['meta'] as const,
  players: (f: object) => ['players', f] as const,
  player: (id: number) => ['player', id] as const,
  games: (f: object) => ['games', f] as const,
  boxscore: (id: number) => ['boxscore', id] as const,
  recorder: (id: number) => ['recorder', id] as const,
  standings: (leagueId: number, seasonId?: number) => ['standings', leagueId, seasonId] as const,
  leaders: (leagueId: number, seasonId?: number) => ['leaders', leagueId, seasonId] as const,
  lineups: (teamId: number, seasonId?: number) => ['lineups', teamId, seasonId] as const,
  matchup: (a: number, b: number, seasonId?: number) => ['matchup', a, b, seasonId] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api<{ user: SessionUser | null }>('/auth/me').then((r) => r.user),
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api<{ user: SessionUser }>('/auth/login', { method: 'POST', body }).then((r) => r.user),
    onSuccess: (user) => {
      qc.setQueryData(keys.me, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData(keys.me, null);
      qc.removeQueries({ queryKey: ['players'] });
      qc.removeQueries({ queryKey: ['player'] });
    },
  });
}

export function useMeta() {
  return useQuery({ queryKey: keys.meta, queryFn: () => api<Meta>('/meta'), staleTime: 10 * 60_000 });
}

export interface PlayerFilters {
  q?: string;
  gender?: Gender;
  leagueId?: number;
  ageGroup?: string;
  status?: PlayerStatus;
  sort?: 'name' | 'recent';
  page?: number;
  pageSize?: number;
}

export function usePlayers(f: PlayerFilters, enabled = true) {
  return useQuery({
    queryKey: keys.players(f),
    queryFn: () => api<PlayerList>('/players', { query: { ...f } }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePlayer(id: number) {
  return useQuery({ queryKey: keys.player(id), queryFn: () => api<PlayerProfile>(`/players/${id}`) });
}

export interface NewPlayer {
  firstName: string;
  lastName: string;
  birthdate: string;
  gender: Gender;
  position: Position;
  heightCm: number | null;
  weightKg: number | null;
  teamId: number | null;
  jersey: string | null;
  leagueIds: number[];
}

export function useRegisterPlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewPlayer) => api<{ id: number }>('/players', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['players'] }),
  });
}

export function useSetStatus(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { status: PlayerStatus; title?: string; detail?: string }) =>
      api(`/players/${id}/status`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.player(id) });
      qc.invalidateQueries({ queryKey: ['players'] });
    },
  });
}

export function useGames(f: { seasonId?: number; leagueId?: number; status?: string; month?: string }) {
  return useQuery({
    queryKey: keys.games(f),
    queryFn: () =>
      api<{ season: { id: number; year: number }; months: string[]; items: Game[] }>('/games', { query: f }),
    placeholderData: keepPreviousData,
  });
}

export function useBoxScore(id: number) {
  return useQuery({
    queryKey: keys.boxscore(id),
    queryFn: () => api<BoxScoreResponse>(`/games/${id}/boxscore`),
    // Live games are pushed (useGameStream); polling is only the fallback if the stream drops.
    refetchInterval: (q) => (q.state.data?.game.status === 'live' ? 30_000 : false),
  });
}

/** Everything the courtside recorder needs: the game, both rosters and the event list. Never cached stale. */
export function useRecorderData(id: number) {
  return useQuery({
    queryKey: keys.recorder(id),
    queryFn: () => api<RecorderData>(`/games/${id}/recorder`),
    staleTime: 0,
    gcTime: 0,
  });
}

/** Game status changes (start, finish, reopen) touch the recorder, the box score and every game list. */
function useGameStatusMutation<T>(id: number, fn: (body: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.recorder(id) });
      qc.invalidateQueries({ queryKey: keys.boxscore(id) });
      qc.invalidateQueries({ queryKey: ['games'] });
    },
  });
}

export function useStartGame(id: number) {
  return useGameStatusMutation(id, (body: { participants: { playerId: number; side: Side; starter: boolean }[] }) =>
    api(`/games/${id}/start`, { method: 'POST', body }),
  );
}

export function useFinishGame(id: number) {
  return useGameStatusMutation(id, () => api(`/games/${id}/finish`, { method: 'POST' }));
}

/** A player who arrived late joins a live game's lineup (on the bench). */
export function useAddLatePlayer(id: number) {
  return useGameStatusMutation(id, (body: { playerId: number; side: Side }) =>
    api(`/games/${id}/participants`, { method: 'POST', body }),
  );
}

/** Organizers only: a live game started by mistake goes back to scheduled (plays and lineup removed). */
export function useResetGame(id: number) {
  return useGameStatusMutation(id, () => api(`/games/${id}/reset`, { method: 'POST' }));
}

export function useReopenGame(id: number) {
  return useGameStatusMutation(id, () => api(`/games/${id}/reopen`, { method: 'POST' }));
}

export function useStandings(leagueId: number | undefined, seasonId?: number) {
  return useQuery({
    queryKey: keys.standings(leagueId ?? 0, seasonId),
    queryFn: () => api<StandingsResponse>('/standings', { query: { leagueId, seasonId } }),
    enabled: !!leagueId,
  });
}

export function useLeaders(leagueId: number | undefined, seasonId?: number) {
  return useQuery({
    queryKey: keys.leaders(leagueId ?? 0, seasonId),
    queryFn: () => api<LeadersResponse>('/leaders', { query: { leagueId, seasonId } }),
    enabled: !!leagueId,
  });
}

export function useLineups(teamId: number | undefined, seasonId?: number) {
  return useQuery({
    queryKey: keys.lineups(teamId ?? 0, seasonId),
    queryFn: () => api<LineupsResponse>('/lineups', { query: { teamId, seasonId } }),
    enabled: !!teamId,
    placeholderData: keepPreviousData,
  });
}

export function useMatchup(a: number | undefined, b: number | undefined, seasonId?: number) {
  return useQuery({
    queryKey: keys.matchup(a ?? 0, b ?? 0, seasonId),
    queryFn: () => api<MatchupResponse>('/matchup', { query: { teamA: a, teamB: b, seasonId } }),
    enabled: !!a && !!b && a !== b,
    placeholderData: keepPreviousData,
  });
}
