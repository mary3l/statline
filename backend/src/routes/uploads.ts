import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { config } from '../config.js';
import { schema } from '../db/index.js';
import { todayManila } from '../services/seasons.js';

const { players } = schema;

const idParams = z.object({ id: z.coerce.number().int().positive() });
const MB = 1024 * 1024;

type Kind = 'photo' | 'birth-cert';
const RULES: Record<Kind, { types: string[]; maxBytes: number; label: string }> = {
  photo: { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 5 * MB, label: 'a JPG, PNG or WebP image' },
  'birth-cert': { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxBytes: 8 * MB, label: 'a PDF, JPG, PNG or WebP file' },
};

/** The real file type from its first bytes (never trust the name or the browser's claim). */
function sniff(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 5 && b.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

const fileFor = (id: number, kind: Kind) => path.resolve(config.UPLOAD_DIR, 'players', `${id}-${kind}`);

/** Files arrive as a data URL in JSON (no multipart dependency); the decoded size is checked per kind. */
function decode(dataUrl: string, kind: Kind): { bytes: Buffer; type: string } {
  const m = /^data:[\w./+-]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'The file could not be read. Try again.');
  const bytes = Buffer.from(m[1]!, 'base64');
  const rule = RULES[kind];
  if (bytes.length > rule.maxBytes) throw new HttpError(413, `The file is too big. Keep it under ${rule.maxBytes / MB} MB.`);
  const type = sniff(bytes);
  if (!type || !rule.types.includes(type)) throw new HttpError(415, `Upload ${rule.label}.`);
  return { bytes, type };
}

/**
 * Player photos (any signed-in user can view; minors' data stays behind the login)
 * and birth certificates (only admins and organizers can view, upload or verify).
 */
export const uploadRoutes: FastifyPluginAsyncZod = async (app) => {
  const office = app.requireRole('admin', 'organizer');
  const body = z.object({ dataUrl: z.string().min(20) });
  const bodyLimit = 12 * MB; // base64 is about 4/3 of the file

  async function player(id: number) {
    const [p] = await app.db.select().from(players).where(eq(players.id, id));
    if (!p) throw new HttpError(404, 'Player not found.');
    return p;
  }

  async function save(id: number, kind: Kind, bytes: Buffer) {
    const file = fileFor(id, kind);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }

  // ---------------------------------------------------------------- photo
  app.get('/:id/photo', { onRequest: app.requireUser, schema: { params: idParams } }, async (req, reply) => {
    const p = await player(req.params.id);
    if (!p.photoType) throw new HttpError(404, 'No photo yet.');
    return reply
      .type(p.photoType)
      .header('Cache-Control', 'private, max-age=86400')
      .header('X-Content-Type-Options', 'nosniff')
      .send(createReadStream(fileFor(p.id, 'photo')));
  });

  app.put('/:id/photo', { onRequest: office, bodyLimit, schema: { params: idParams, body } }, async (req) => {
    const p = await player(req.params.id);
    const { bytes, type } = decode(req.body.dataUrl, 'photo');
    await save(p.id, 'photo', bytes);
    await app.db.update(players).set({ photoType: type, photoUpdatedAt: new Date() }).where(eq(players.id, p.id));
    return { ok: true };
  });

  app.delete('/:id/photo', { onRequest: office, schema: { params: idParams } }, async (req) => {
    const p = await player(req.params.id);
    await rm(fileFor(p.id, 'photo'), { force: true });
    await app.db.update(players).set({ photoType: null, photoUpdatedAt: null }).where(eq(players.id, p.id));
    return { ok: true };
  });

  // ---------------------------------------------------------------- birth certificate
  app.get('/:id/birth-certificate', { onRequest: office, schema: { params: idParams } }, async (req, reply) => {
    const p = await player(req.params.id);
    if (!p.birthCertType) throw new HttpError(404, 'No birth certificate uploaded.');
    const ext = p.birthCertType === 'application/pdf' ? 'pdf' : p.birthCertType.split('/')[1];
    return reply
      .type(p.birthCertType)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `inline; filename="birth-certificate-${p.lastName.replace(/[^\w-]/g, '')}-${p.id}.${ext}"`)
      .send(createReadStream(fileFor(p.id, 'birth-cert')));
  });

  app.put('/:id/birth-certificate', { onRequest: office, bodyLimit, schema: { params: idParams, body } }, async (req) => {
    const p = await player(req.params.id);
    const { bytes, type } = decode(req.body.dataUrl, 'birth-cert');
    await save(p.id, 'birth-cert', bytes);
    // A new document has to be checked again.
    await app.db
      .update(players)
      .set({ birthCertType: type, birthCertUploadedAt: new Date(), birthCertVerifiedOn: null })
      .where(eq(players.id, p.id));
    return { ok: true };
  });

  app.delete('/:id/birth-certificate', { onRequest: office, schema: { params: idParams } }, async (req) => {
    const p = await player(req.params.id);
    await rm(fileFor(p.id, 'birth-cert'), { force: true });
    await app.db.update(players).set({ birthCertType: null, birthCertUploadedAt: null, birthCertVerifiedOn: null }).where(eq(players.id, p.id));
    return { ok: true };
  });

  /** An organizer checked the document against the registered birthdate. */
  app.post(
    '/:id/birth-certificate/verify',
    { onRequest: office, schema: { params: idParams, body: z.object({ verified: z.boolean() }) } },
    async (req) => {
      const p = await player(req.params.id);
      if (req.body.verified && !p.birthCertType) throw new HttpError(409, 'Upload the birth certificate before marking it verified.');
      await app.db
        .update(players)
        .set({ birthCertVerifiedOn: req.body.verified ? todayManila() : null })
        .where(eq(players.id, p.id));
      return { ok: true };
    },
  );
};
