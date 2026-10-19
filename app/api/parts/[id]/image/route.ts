import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getPartImageFile, savePartImage } from '@/lib/parts/catalog';
import { partsContext, partsError } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 2 * 1024 * 1024;

function isVercelBlobUrl(value: string) {
  try {
    return new URL(value).hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

/**
 * Serves the part's picture to any logged-in user. The Blob store of this project is public (as the
 * library's), so the file is fetched on the server and streamed from here: the screens never see
 * the Blob address, and the route still checks the session.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const file = await getPartImageFile(id);
    if (!file || !isVercelBlobUrl(file.url)) return NextResponse.json({ error: 'Sem imagem.' }, { status: 404 });
    const upstream = await fetch(file.url, { cache: 'no-store' });
    if (!upstream.ok || !upstream.body) return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 404 });
    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': IMAGE_TYPES[file.contentType] ? file.contentType : 'application/octet-stream',
        // The URL carries the image id (?v=), so a new picture is a new URL.
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return partsError(error, 'get part image');
  }
}

/** Admin uploads a picture (the screen already shrinks it to ~800 px). */
export async function POST(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Envie uma imagem.' }, { status: 400 });
    const extension = IMAGE_TYPES[file.type];
    if (!extension) return NextResponse.json({ error: 'Use uma imagem JPG, PNG ou WebP.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Imagem muito grande (máximo 2 MB).' }, { status: 400 });

    const blob = await put(`parts/${id}-${Date.now()}.${extension}`, Buffer.from(await file.arrayBuffer()), {
      access: 'public',
      addRandomSuffix: true,
      contentType: file.type,
    });
    const part = await savePartImage(id, { url: blob.url, contentType: file.type, size: file.size }, context.actor);
    return NextResponse.json({ part });
  } catch (error) {
    return partsError(error, 'upload part image');
  }
}
