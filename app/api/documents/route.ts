import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { verifyAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { ensureLibrarySchema } from '@/lib/library-schema';

export const runtime = 'nodejs';

function normalizeDocumentAudience(value: string | null | undefined) {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized.includes('admin')) return 'Administrativo';
  if (
    normalized.includes('individual') ||
    normalized.includes('tecnico') ||
    normalized.includes('colaborador') ||
    normalized.includes('pessoal')
  ) {
    return 'Individual';
  }

  return 'Global';
}

function sanitizeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function getFileTitle(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, '');
}

function getDocumentType(fileName: string, mimeType: string) {
  const extension = fileName.split('.').pop();
  if (extension && extension !== fileName && extension.length <= 10) {
    return extension.toUpperCase();
  }

  return mimeType || 'Arquivo';
}

type DocumentAuthScope = {
  role: 'admin' | 'technician';
  technicianId?: string;
};

async function listDocuments(scope: DocumentAuthScope) {
  const conditions: string[] = [];
  const params: string[] = [];

  if (scope.role !== 'admin') {
    params.push(scope.technicianId ?? '');
    conditions.push(`d.audience <> 'Administrativo'`);
    conditions.push(`(d.audience <> 'Individual' OR d.technician_id = $${params.length})`);
  }

  conditions.push(`(d.audience <> 'Individual' OR t.status = 'active')`);

  const query = `
    SELECT
      d.id,
      d.title,
      d.category,
      d.audience,
      d.technician_id,
      t.name AS "technician_name",
      TO_CHAR(d.updated_at::date, 'YYYY-MM-DD') AS "updatedAt",
      d.type,
      d.url,
      d.uploaded_by AS "uploadedBy"
    FROM library_documents d
    LEFT JOIN technicians t ON t.id::text = d.technician_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY d.updated_at DESC, d.created_at DESC
  `;

  return sql.query(query, params);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await ensureLibrarySchema();

    const documents = await listDocuments({ role: auth.role, technicianId: auth.technicianId || auth.userId });
    return NextResponse.json({ documents });
  } catch (error) {
    console.error('[documents] Get documents error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (auth.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await ensureLibrarySchema();

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Envie um arquivo válido.' }, { status: 400 });
    }

    const id = randomUUID();
    const title = String(formData.get('title') || getFileTitle(file.name) || 'Documento').trim();
    const category = String(formData.get('category') || 'Não classificado').trim() || 'Não classificado';
    const audience = normalizeDocumentAudience(String(formData.get('audience') || 'Global'));
    const technicianId = String(formData.get('technician_id') || '').trim();

    let targetTechnicianId: string | null = null;
    if (audience === 'Individual') {
      if (!technicianId) {
        return NextResponse.json({ error: 'Selecione o técnico destinatário do documento individual.' }, { status: 400 });
      }

      const technicians = await sql`
        SELECT id
        FROM technicians
        WHERE id::text = ${technicianId}
          AND status = 'active'
        LIMIT 1
      `;

      if (!technicians.length) {
        return NextResponse.json({ error: 'Técnico destinatário não encontrado ou inativo.' }, { status: 404 });
      }

      targetTechnicianId = String(technicians[0].id);
    }

    const safeName = sanitizeFileName(file.name || `documento-${id}`) || `documento-${id}`;
    const fileName = `${id}-${safeName}`;
    const pathname = `library/${fileName}`;
    const documentType = getDocumentType(file.name || fileName, file.type);
    const buffer = Buffer.from(await file.arrayBuffer());

    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType: file.type || 'application/octet-stream',
    });

    const url = blob.url;

    const result = await sql`
      INSERT INTO library_documents (
        id, title, category, audience, technician_id, type, url, file_name, file_size, uploaded_by
      )
      VALUES (
        ${id}, ${title}, ${category}, ${audience}, ${targetTechnicianId}, ${documentType}, ${url}, ${fileName}, ${file.size}, ${auth.email}
      )
      RETURNING
        id,
        title,
        category,
        audience,
        technician_id,
        (
          SELECT name
          FROM technicians
          WHERE technicians.id::text = library_documents.technician_id
          LIMIT 1
        ) AS "technician_name",
        TO_CHAR(updated_at::date, 'YYYY-MM-DD') AS "updatedAt",
        type,
        url,
        uploaded_by AS "uploadedBy"
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[documents] Create document error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
