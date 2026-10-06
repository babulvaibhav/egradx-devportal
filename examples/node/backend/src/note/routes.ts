import { randomUUID } from 'node:crypto';
import { Router, json, type Request } from 'express';
import {
  EgradxAuditEvent,
  NotFoundException,
  ValidationException,
  currentCaller,
  egradxTransaction,
  EgradxMessageRequest,
  type Egradx,
} from '@babulvaibhav/egradx-sdk';
import { requireAuthority } from '@babulvaibhav/egradx-sdk/express';
import type { Events } from '@babulvaibhav/egradx-events';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AuditActions } from './audit-actions.js';

/** The kind of message a new note is: the bell shows it, and it names the email template. */
export const NOTE_CREATED = 'notes.note.created';

interface NoteView {
  id: string;
  organizationId: string;
  title: string;
  body: string | null;
}

// docs:region note-validation
function titleOf(request: Request): string {
  const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
  if (!title) {
    throw new ValidationException('A note needs a title', 'NOTE_TITLE_REQUIRED'); // 400, with this code
  }
  return title;
}
// docs:end

// docs:region tenant-scope
/** Who is calling, in which organization. The routes are protected, so there always is one. */
function caller(): { userId: string; organizationId: string } {
  const user = currentCaller()!;
  return { userId: user.userId, organizationId: user.organizationId! };
}

/** A note of the caller's organization; another organization's note does not exist, as far as they can tell. */
async function find(db: Prisma.TransactionClient | PrismaClient, id: string): Promise<NoteView> {
  const note = await db.note.findFirst({ where: { id, organizationId: caller().organizationId } });
  if (!note) {
    throw new NotFoundException(`There is no note ${id}`, 'NOTE_NOT_FOUND');
  }
  return note;
}
// docs:end

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A transaction every SDK library joins without being passed it (the audit record, the notice, the event), with
 * the client this application's own queries run on inside it.
 */
function inTransaction<R>(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R> {
  return egradxTransaction(prisma, (tx) => fn(tx as unknown as Prisma.TransactionClient));
}

// docs:region note-routes
export function noteRoutes(prisma: PrismaClient, egradx: Egradx, events: Events): Router {
  const router = Router();
  // Every route states the permission it needs; the caller's permissions are resolved on each request.
  router.use('/api/notes', json());

  router.get('/api/notes', requireAuthority('note.read'), async (_request, response) => {
    response.json(await prisma.note.findMany({ where: { organizationId: caller().organizationId }, orderBy: { title: 'asc' } }));
  });

  router.post('/api/notes', requireAuthority('note.write'), async (request, response) => {
    const { userId, organizationId } = caller();
    const note = await inTransaction(prisma, async (tx) => {          // one transaction: the note, its record, its notice
      const created = await tx.note.create({
        data: { id: randomUUID(), organizationId, title: titleOf(request), body: request.body.body ?? null },
      });
      await egradx.auditor.record(EgradxAuditEvent.of(AuditActions.CREATED)   // the audit trail, committed with the note
        .organization(organizationId).entity('note', created.id, created.title).after(created).build());
      await egradx.notifications.publishToOrganization(organizationId, {     // the bell of everyone in the organization
        notificationKey: NOTE_CREATED, title: 'New note', body: created.title, metadata: { noteId: created.id },
      });
      await emailTheAuthor(egradx, organizationId, userId, created.title);
      await events.publish('notes.note.created.v1', { noteId: created.id, title: created.title }, // sent after commit
        { subject: created.id, organizationId });
      return created;
    });
    response.status(201).json(note);
  });
  // docs:end

  /** How many notes the organization has created: kept by an event handler, so it follows a moment later. */
  router.get('/api/notes/stats', requireAuthority('note.read'), async (_request, response) => {
    const stats = await prisma.noteStats.findUnique({ where: { organizationId: caller().organizationId } });
    response.json({ notesCreated: Number(stats?.notesCreated ?? 0) });
  });

  router.get('/api/notes/:id', requireAuthority('note.read'), async (request, response) => {
    response.json(await find(prisma, idOf(request)));
  });

  // docs:region note-update
  router.put('/api/notes/:id', requireAuthority('note.write'), async (request, response) => {
    const after = await inTransaction(prisma, async (tx) => {
      const before = await find(tx, idOf(request));                   // a copy, taken before the change
      const changed = await tx.note.update({
        where: { id: before.id },
        data: { title: titleOf(request), body: request.body.body ?? null },
      });
      await egradx.auditor.record(EgradxAuditEvent.of(AuditActions.UPDATED)
        .organization(changed.organizationId).entity('note', changed.id, changed.title)
        .before(before).after(changed)                                  // the record lists the fields that changed
        .build());
      return changed;
    });
    response.json(after);
  });
  // docs:end

  router.delete('/api/notes/:id', requireAuthority('note.write'), async (request, response) => {
    await inTransaction(prisma, async (tx) => {
      const note = await find(tx, idOf(request));
      await egradx.auditor.record(EgradxAuditEvent.of(AuditActions.DELETED)
        .organization(note.organizationId).entity('note', note.id, note.title).before(note).build());
      await tx.note.delete({ where: { id: note.id } });
    });
    response.status(204).end();
  });

  return router;
}

/** A malformed id is a malformed request: 400, as Java and Python answer it. */
function idOf(request: Request): string {
  const id = String(request.params.id);
  if (!UUID.test(id)) {
    throw new ValidationException(`Invalid value for 'id': ${id}`);
  }
  return id;
}

// docs:region note-email
/**
 * Tells the author by email. The message is queued with the note, in its transaction, and sent after commit by the
 * SDK's dispatcher, with retries. When the organization has no email set up, there is nothing to queue.
 */
async function emailTheAuthor(egradx: Egradx, organizationId: string, userId: string, title: string): Promise<void> {
  const email = egradx.notifications.channels.find('email');
  if (!email || (await email.unavailableFor?.(organizationId))) {
    return;
  }
  await egradx.notifications.messenger.send(EgradxMessageRequest.on('email')
    .organization(organizationId)
    .template(NOTE_CREATED, { title })
    .toUsers(userId)                                                  // their verified address, or the one they sign in with
    .build());
}
// docs:end
