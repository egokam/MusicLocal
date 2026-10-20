import { Directory, File } from 'expo-file-system';

type ArtworkBytes = {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
};

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
const EMBEDDED_ARTWORK_READ_LIMIT = 16 * 1024 * 1024;

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

const imageMime = (bytes: Uint8Array, fallback = 'image/jpeg') => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'image/heic';
  return fallback;
};

const extensionForMime = (mimeType: string) => {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/heic') return '.heic';
  return '.jpg';
};

const imageExtension = (name: string) => {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.includes(extension) ? extension : '.jpg';
};

const hasBytes = (bytes: Uint8Array, offset: number, values: number[]) =>
  values.every((value, index) => bytes[offset + index] === value);

const ascii = (bytes: Uint8Array, start: number, length: number) => {
  let value = '';
  for (let index = start; index < start + length && index < bytes.length; index += 1) value += String.fromCharCode(bytes[index]);
  return value;
};

const uint32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] ?? 0) * 0x1000000) + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0);

const syncSafe32 = (bytes: Uint8Array, offset: number) =>
  (((bytes[offset] ?? 0) & 0x7f) << 21) + (((bytes[offset + 1] ?? 0) & 0x7f) << 14) + (((bytes[offset + 2] ?? 0) & 0x7f) << 7) + ((bytes[offset + 3] ?? 0) & 0x7f);

const readArtworkBytes = (bytes: Uint8Array, mimeType?: string): ArtworkBytes => {
  const resolvedMime = imageMime(bytes, mimeType || 'image/jpeg');
  return { bytes, mimeType: resolvedMime, extension: extensionForMime(resolvedMime) };
};

const parseApicFrame = (frame: Uint8Array): ArtworkBytes | null => {
  if (frame.length < 4) return null;
  const encoding = frame[0];
  let mimeEnd = 1;
  while (mimeEnd < frame.length && frame[mimeEnd] !== 0) mimeEnd += 1;
  if (mimeEnd >= frame.length) return null;
  const mime = ascii(frame, 1, mimeEnd - 1) || 'image/jpeg';
  const descriptionStart = mimeEnd + 2;
  let imageStart = descriptionStart;
  if (encoding === 1 || encoding === 2) {
    for (let index = descriptionStart; index + 1 < frame.length; index += 2) {
      if (frame[index] === 0 && frame[index + 1] === 0) {
        imageStart = index + 2;
        break;
      }
    }
  } else {
    while (imageStart < frame.length && frame[imageStart] !== 0) imageStart += 1;
    imageStart += 1;
  }
  if (imageStart >= frame.length) return null;
  return readArtworkBytes(frame.slice(imageStart), mime.startsWith('image/') ? mime : undefined);
};

const parseId3Artwork = (bytes: Uint8Array): ArtworkBytes | null => {
  if (!hasBytes(bytes, 0, [0x49, 0x44, 0x33]) || bytes.length < 10) return null;
  const version = bytes[3];
  const tagEnd = Math.min(bytes.length, 10 + syncSafe32(bytes, 6));
  let offset = 10;
  while (offset + 10 <= tagEnd) {
    const frameId = ascii(bytes, offset, version === 2 ? 3 : 4);
    if (!frameId.trim() || frameId.charCodeAt(0) === 0) break;
    const headerLength = version === 2 ? 6 : 10;
    const frameSize = version === 2
      ? ((bytes[offset + 3] ?? 0) << 16) + ((bytes[offset + 4] ?? 0) << 8) + (bytes[offset + 5] ?? 0)
      : version >= 4 ? syncSafe32(bytes, offset + 4) : uint32(bytes, offset + 4);
    const frameStart = offset + headerLength;
    const frameEnd = Math.min(tagEnd, frameStart + frameSize);
    if ((frameId === 'APIC' || frameId === 'PIC') && frameEnd > frameStart) {
      const parsed = parseApicFrame(bytes.slice(frameStart, frameEnd));
      if (parsed) return parsed;
    }
    offset = frameEnd > offset ? frameEnd : offset + headerLength;
  }
  return null;
};

const parseFlacPicture = (bytes: Uint8Array): ArtworkBytes | null => {
  if (!hasBytes(bytes, 0, [0x66, 0x4c, 0x61, 0x43])) return null;
  let offset = 4;
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const blockType = header & 0x7f;
    const blockSize = ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0);
    const blockStart = offset + 4;
    const blockEnd = Math.min(bytes.length, blockStart + blockSize);
    if (blockType === 6 && blockEnd > blockStart + 32) {
      let cursor = blockStart + 4;
      const readLength = () => {
        const length = uint32(bytes, cursor);
        cursor += 4;
        return length;
      };
      const mimeLength = readLength();
      cursor += mimeLength;
      const descriptionLength = readLength();
      cursor += descriptionLength;
      cursor += 16;
      const pictureLength = readLength();
      if (pictureLength > 0 && cursor + pictureLength <= blockEnd) return readArtworkBytes(bytes.slice(cursor, cursor + pictureLength));
    }
    offset = blockEnd;
    if (header & 0x80) break;
  }
  return null;
};

const parseMp4Artwork = (bytes: Uint8Array): ArtworkBytes | null => {
  const containers = new Set(['moov', 'udta', 'meta', 'ilst', 'covr']);
  const visit = (start: number, end: number): ArtworkBytes | null => {
    let offset = start;
    while (offset + 8 <= end) {
      const declaredSize = uint32(bytes, offset);
      const type = ascii(bytes, offset + 4, 4);
      let headerSize = 8;
      let atomSize = declaredSize;
      if (declaredSize === 1 && offset + 16 <= end) {
        atomSize = Number(BigInt(uint32(bytes, offset + 12)) + (BigInt(uint32(bytes, offset + 8)) << 32n));
        headerSize = 16;
      }
      if (atomSize < headerSize || offset + atomSize > end) break;
      const dataStart = offset + headerSize;
      const dataEnd = offset + atomSize;
      if (type === 'data' && dataEnd > dataStart + 16) {
        const imageStart = dataStart + 8;
        const image = bytes.slice(imageStart + 8, dataEnd);
        if (image.length > 0) return readArtworkBytes(image);
      }
      if (containers.has(type)) {
        const childStart = type === 'meta' ? Math.min(dataStart + 4, dataEnd) : dataStart;
        const found = visit(childStart, dataEnd);
        if (found) return found;
      }
      offset += atomSize;
    }
    return null;
  };
  return visit(0, bytes.length);
};

const readEmbeddedArtwork = async (audioFile: File): Promise<ArtworkBytes | null> => {
  const extension = audioFile.extension.toLowerCase();
  if (!['.mp3', '.m4a', '.mp4', '.flac'].includes(extension)) return null;
  const size = audioFile.size || 0;
  if (!size || size > EMBEDDED_ARTWORK_READ_LIMIT) return null;
  try {
    const bytes = new Uint8Array(await audioFile.arrayBuffer());
    if (extension === '.mp3') return parseId3Artwork(bytes);
    if (extension === '.flac') return parseFlacPicture(bytes);
    return parseMp4Artwork(bytes);
  } catch {
    return null;
  }
};

const sidecarNames = (audioFile: File) => {
  const baseName = audioFile.name.replace(/\.[^.]+$/, '');
  const names: string[] = [];
  for (const stem of [baseName, 'cover', 'folder', 'front', 'album', 'artwork']) {
    for (const extension of IMAGE_EXTENSIONS) names.push(`${stem}${extension}`);
  }
  return names;
};

export const findAdjacentArtwork = (audioFile: File): File | undefined => {
  for (const name of sidecarNames(audioFile)) {
    const candidate = new File(audioFile.parentDirectory, name);
    if (candidate.exists) return candidate;
  }
  return undefined;
};

const findStoredArtwork = (directory: Directory, id: string): File | undefined => {
  for (const extension of IMAGE_EXTENSIONS) {
    const candidate = new File(directory, `${safeName(id)}-artwork${extension}`);
    if (candidate.exists) return candidate;
  }
  return undefined;
};

const writeArtwork = (data: ArtworkBytes, directory: Directory, id: string): File => {
  const target = new File(directory, `${safeName(id)}-artwork${data.extension}`);
  if (target.exists) target.delete();
  target.create({ intermediates: true });
  target.write(data.bytes);
  return target;
};

export const cacheArtworkForTrack = async (
  audioFile: File,
  directory: Directory,
  id: string,
  sourceArtwork?: string,
): Promise<string | undefined> => {
  const stored = findStoredArtwork(directory, id);
  if (stored) return stored.uri;

  if (sourceArtwork?.startsWith('file://')) {
    const existingArtwork = new File(sourceArtwork);
    if (existingArtwork.exists) return existingArtwork.uri;
  }

  const sidecar = findAdjacentArtwork(audioFile);
  if (sidecar) {
    if (sidecar.uri.startsWith(directory.uri)) return sidecar.uri;
    const target = new File(directory, `${safeName(id)}-artwork${imageExtension(sidecar.name)}`);
    if (target.exists) target.delete();
    await sidecar.copy(target);
    return target.uri;
  }

  const embedded = await readEmbeddedArtwork(audioFile);
  if (embedded) return writeArtwork(embedded, directory, id).uri;

  if (sourceArtwork?.startsWith('http://') || sourceArtwork?.startsWith('https://')) {
    try {
      const target = new File(directory, `${safeName(id)}-artwork.jpg`);
      await File.downloadFileAsync(sourceArtwork, target, { idempotent: true });
      return target.uri;
    } catch {
      // Artwork is optional; playback should continue if the cover server is unavailable.
    }
  }
  return undefined;
};
