import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { keys } from './queries';

/** Reads a file as a data URL; images can be shrunk first so phone photos upload fast and stay small. */
export async function fileToDataUrl(file: File, maxSide?: number): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(file);
  });
  if (!maxSide || !/^image\/(jpeg|png|webp)$/.test(file.type)) return raw;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('That image could not be opened.'));
    i.src = raw;
  });
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && file.size < 1024 * 1024) return raw;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.86);
}

function usePlayerFileMutation<T>(playerId: number, fn: (arg: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: keys.player(playerId) }) });
}

export const useUploadPhoto = (id: number) =>
  usePlayerFileMutation(id, async (file: File) => api(`/players/${id}/photo`, { method: 'PUT', body: { dataUrl: await fileToDataUrl(file, 800) } }));
export const useRemovePhoto = (id: number) => usePlayerFileMutation(id, () => api(`/players/${id}/photo`, { method: 'DELETE' }));
export const useUploadBirthCert = (id: number) =>
  usePlayerFileMutation(id, async (file: File) =>
    api(`/players/${id}/birth-certificate`, { method: 'PUT', body: { dataUrl: await fileToDataUrl(file, 2200) } }),
  );
export const useRemoveBirthCert = (id: number) => usePlayerFileMutation(id, () => api(`/players/${id}/birth-certificate`, { method: 'DELETE' }));
export const useVerifyBirthCert = (id: number) =>
  usePlayerFileMutation(id, (verified: boolean) => api(`/players/${id}/birth-certificate/verify`, { method: 'POST', body: { verified } }));
