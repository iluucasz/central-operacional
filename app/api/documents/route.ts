import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { demoDocuments } from '@/lib/demo-data';
import type { LibraryDocument } from '@/lib/types';

export const runtime = 'nodejs';

const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'library');
const metadataPath = path.join(uploadsDir, 'documents.json');

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

async function readDocuments(): Promise<LibraryDocument[]> {
  try {
    const content = await readFile(metadataPath, 'utf8');
    const documents = JSON.parse(content) as LibraryDocument[];
    return documents.length ? documents : demoDocuments;
  } catch {
    return demoDocuments;
  }
}

async function writeDocuments(documents: LibraryDocument[]) {
  await mkdir(uploadsDir, { recursive: true });
  await writeFile(metadataPath, JSON.stringify(documents, null, 2), 'utf8');
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const documents = await readDocuments();
  const visibleDocuments = auth.role === 'admin'
    ? documents
    : documents.filter((document) => normalizeDocumentAudience(document.audience) !== 'Administrativo');

  return NextResponse.json({ documents: visibleDocuments });
}

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File) || file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'PDF file is required' }, { status: 400 });
  }

  await mkdir(uploadsDir, { recursive: true });

  const id = randomUUID();
  const safeName = sanitizeFileName(file.name || `documento-${id}.pdf`) || `documento-${id}.pdf`;
  const fileName = `${id}-${safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`}`;
  const filePath = path.join(uploadsDir, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(filePath, buffer);

  const document: LibraryDocument = {
    id,
    title: String(formData.get('title') || file.name.replace(/\.pdf$/i, '') || 'Documento'),
    category: String(formData.get('category') || 'Não classificado'),
    audience: normalizeDocumentAudience(String(formData.get('audience') || 'Global')),
    updatedAt: new Date().toISOString().slice(0, 10),
    type: 'PDF',
    url: `/uploads/library/${fileName}`,
    uploadedBy: auth.email,
  };

  const documents = await readDocuments();
  const nextDocuments = [document, ...documents.filter((item) => item.id !== document.id)];
  await writeDocuments(nextDocuments);

  return NextResponse.json(document, { status: 201 });
}
