import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, newId, notFound } from '@school-erp/shared';
import { MAX_DOCUMENT_BYTES, SENSITIVE_DOCUMENT_TYPES } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { StudentsService } from '../students/students.service.js';
import { FILE_STORAGE, safeFileName, sniffType } from '../storage/file-storage.js';
import type { FileStorage } from '../storage/file-storage.js';
import { ApplicationsService } from './applications.service.js';

const d = schema.documents;
const LINK_TTL_SECONDS = 300;

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

const columns = {
  id: d.id,
  studentId: d.studentId,
  applicationId: d.applicationId,
  docType: d.docType,
  fileName: d.fileName,
  contentType: d.contentType,
  sizeBytes: d.sizeBytes,
  createdAt: d.createdAt,
  uploadedByName: schema.users.fullName,
};

type Owner = { studentId?: string; applicationId?: string };

/**
 * Documents attached to students or applications. Files go to private storage; the API
 * hands out 5-minute links after checking permissions, and logs every download.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly audit: AuditService,
    private readonly students: StudentsService,
    private readonly applications: ApplicationsService,
  ) {}

  /** Checks the caller may read (or change) the owner; returns its campus. */
  private async ownerCampus(tx: Transaction, access: TenantAccess, owner: Owner, write: boolean) {
    if (owner.studentId) {
      const s = write
        ? await this.students.managedStudent(tx, access, owner.studentId)
        : await this.students.visibleStudent(tx, access, owner.studentId);
      // Class teachers can see students but not their documents.
      if (
        !write &&
        !access.has('students.view', s.campusId) &&
        !access.has('students.manage', s.campusId)
      ) {
        throw notFound('Student');
      }
      return s.campusId;
    }
    const a = await this.applications.load(
      tx,
      access,
      owner.applicationId!,
      write ? 'admissions.manage' : 'admissions.view',
    );
    if (write && ['withdrawn', 'admitted'].includes(a.status)) {
      throw new AppError('CONFLICT', 'This application is closed', {
        reason: 'application_closed',
      });
    }
    return a.campusId;
  }

  async upload(
    access: TenantAccess,
    owner: Owner,
    docType: string,
    file: UploadedFile | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new AppError('VALIDATION_FAILED', 'Choose a file to upload', {
        fields: { file: 'Required' },
      });
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new AppError('VALIDATION_FAILED', 'Files can be at most 5 MB', {
        fields: { file: 'Too large' },
      });
    }
    const type = sniffType(file.buffer);
    if (!type) {
      throw new AppError('VALIDATION_FAILED', 'Upload a PDF, JPG, PNG or WebP file', {
        fields: { file: 'Unsupported file type' },
      });
    }
    const id = newId();
    const fileName = safeFileName(file.originalname, type);
    const storageKey = `t/${access.tenantId}/d/${id}/${fileName}`;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    // Check permission before sending the file anywhere.
    await withTenant(
      this.handle.db,
      access.ctx,
      (tx) => this.ownerCampus(tx, access, owner, true),
      {
        readOnly: true,
      },
    );
    await this.storage.put(storageKey, file.buffer, type);
    try {
      return await withTenant(this.handle.db, access.ctx, async (tx) => {
        const campusId = await this.ownerCampus(tx, access, owner, true);
        await tx.insert(d).values({
          id,
          tenantId: access.tenantId,
          studentId: owner.studentId ?? null,
          applicationId: owner.applicationId ?? null,
          docType,
          fileName,
          contentType: type,
          sizeBytes: file.size,
          sha256,
          storageKey,
          uploadedBy: access.userId,
        });
        await this.audit.record(tx, access, {
          action: 'document.uploaded',
          entity: owner.studentId ? 'student' : 'admission_application',
          entityId: owner.studentId ?? owner.applicationId!,
          campusId,
          diff: { documentId: id, docType, fileName, sizeBytes: file.size },
        });
        return { id, fileName, docType, contentType: type, sizeBytes: file.size };
      });
    } catch (err) {
      // Do not leave an orphaned file behind.
      await this.storage
        .delete(storageKey)
        .catch((e: unknown) =>
          this.logger.error(`Could not remove orphaned upload ${storageKey}: ${String(e)}`),
        );
      throw err;
    }
  }

  list(access: TenantAccess, owner: Owner) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const campusId = await this.ownerCampus(tx, access, owner, false);
        const rows = await tx
          .select(columns)
          .from(d)
          .leftJoin(schema.users, eq(schema.users.id, d.uploadedBy))
          .where(
            and(
              owner.studentId
                ? eq(d.studentId, owner.studentId)
                : eq(d.applicationId, owner.applicationId!),
              isNull(d.deletedAt),
            ),
          )
          .orderBy(desc(d.createdAt));
        const sensitiveOk = access.has('students.sensitive.view', campusId);
        return rows.map((r) => ({
          ...r,
          sensitive: SENSITIVE_DOCUMENT_TYPES.includes(r.docType),
          canOpen: sensitiveOk || !SENSITIVE_DOCUMENT_TYPES.includes(r.docType),
        }));
      },
      { readOnly: true },
    );
  }

  private async loadDoc(tx: Transaction, id: string) {
    const [doc] = await tx
      .select()
      .from(d)
      .where(and(eq(d.id, id), isNull(d.deletedAt)));
    if (!doc) throw notFound('Document');
    return doc;
  }

  /** Owner as seen by the caller: the student once admitted, else the application. */
  private ownerOf(doc: { studentId: string | null; applicationId: string | null }): Owner {
    return doc.studentId ? { studentId: doc.studentId } : { applicationId: doc.applicationId! };
  }

  downloadUrl(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const doc = await this.loadDoc(tx, id);
      const campusId = await this.ownerCampus(tx, access, this.ownerOf(doc), false).catch(() => {
        throw notFound('Document');
      });
      if (
        SENSITIVE_DOCUMENT_TYPES.includes(doc.docType) &&
        !access.has('students.sensitive.view', campusId)
      ) {
        throw new AppError('FORBIDDEN', 'You do not have permission to open this kind of document');
      }
      const url = await this.storage.signedDownloadUrl(doc.storageKey, LINK_TTL_SECONDS);
      await this.audit.record(tx, access, {
        action: 'document.downloaded',
        entity: doc.studentId ? 'student' : 'admission_application',
        entityId: doc.studentId ?? doc.applicationId!,
        campusId,
        diff: { documentId: id, docType: doc.docType },
      });
      return { url, expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString() };
    });
  }

  remove(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const doc = await this.loadDoc(tx, id);
      const campusId = await this.ownerCampus(tx, access, this.ownerOf(doc), true).catch(
        (e: unknown) => {
          if (e instanceof AppError && e.code === 'CONFLICT') throw e;
          throw notFound('Document');
        },
      );
      await tx
        .update(d)
        .set({ deletedAt: new Date(), deletedBy: access.userId })
        .where(eq(d.id, id));
      await this.audit.record(tx, access, {
        action: 'document.deleted',
        entity: doc.studentId ? 'student' : 'admission_application',
        entityId: doc.studentId ?? doc.applicationId!,
        campusId,
        diff: { documentId: id, docType: doc.docType, fileName: doc.fileName },
      });
      // Remove the file last: if this fails the record is still marked deleted and
      // the file is unreachable (no link is ever issued for a deleted document).
      await this.storage
        .delete(doc.storageKey)
        .catch((e: unknown) =>
          this.logger.error(`Could not delete ${doc.storageKey}: ${String(e)}`),
        );
    });
  }
}
