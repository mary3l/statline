import { useSearchParams } from 'react-router-dom';

/** Page filters kept in the URL (so a view can be shared or bookmarked). Empty values are removed. */
export function useUrlState() {
  const [params, setParams] = useSearchParams();
  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  return { params, set };
}
