/**
 * Downscale and re-encode a screenshot in the browser before upload.
 * Phone screenshots are ~1170x2532 and several MB; that is far more resolution
 * than the vision model needs to read chat bubbles, and shipping them raw
 * blows out both the request payload and the token count.
 */
export async function downscale(
  file: File,
  maxDim = 1200,
  quality = 0.8
): Promise<{ mimeType: string; data: string }> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return {
    mimeType: 'image/jpeg',
    data: dataUrl.split(',')[1],
  };
}

/** Chunk into batches so each request stays under the free-tier RPM ceiling. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Screenshots are almost always named so they sort chronologically
 * (IMG_0123, Screenshot_20240115_103200). Natural sort keeps the
 * conversation in order, which matters for the transcript.
 */
export function sortByName(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );
}
