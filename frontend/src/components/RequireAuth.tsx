import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMe } from '../api/queries';
import { Loading } from './ui';

/** Player data includes minors' birthdates, so the registry and profiles need a signed-in user. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}
