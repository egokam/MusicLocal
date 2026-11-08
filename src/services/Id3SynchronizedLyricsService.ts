import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { parseBuffer } from 'music-metadata';
import type { LyricsAttribution } from '../types';

export type EmbeddedMp3LyricsPayload = {
  version: 1;
  format: 'ttml' | 'line' | 'plain';
  text: string;
  source?: string;
  attribution?: LyricsAttribution;
};

export type SynchronizedLyricEntry = {
  text: string;
  timestampMs: number;
};

type Id3Frame = {
  id: string;
  payload: Uint8Array;
};

const SYNCHRONIZER_DESCRIPTOR = 'Musiqapp LRC Synchronizer';
const MUSIQAPP_LYRICS_DESCRIPTOR = 'MUSIQAPP_LYRICS_V1';
const OUTPUT_DIRECTORY = new Directory(Paths.cache, 'musiqapp-synchronized');

const readSynchsafeInteger = (bytes: Uint8Array, offset: number) => {
  const parts = [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
  if (parts.some((part) => part === undefined || (part & 0x80) !== 0)) {
    throw new Error('The MP3 contains an invalid ID3 tag size.');
  }
  return ((parts[0] & 0x7f) << 21) | ((parts[1] & 0x7f) << 14) | ((parts[2] & 0x7f) << 7) | (parts[3] & 0x7f);
};

const writeSynchsafeInteger = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fffffff) {
    throw new Error('The MP3 ID3 tag is too large to update safely.');
  }
  return new Uint8Array([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
};

const readBigEndianInteger = (bytes: Uint8Array, offset: number) => (
  bytes[offset] * 0x1000000
  + bytes[offset + 1] * 0x10000
  + bytes[offset + 2] * 0x100
  + bytes[offset + 3]
);

const writeBigEndianInteger = (value: number) => new Uint8Array([
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]);

const encodeUtf8 = (value: string) => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      if (codePoint <= 0xdbff && index + 1 < value.length) {
        const lowSurrogate = value.charCodeAt(index + 1);
        if (lowSurrogate >= 0xdc00 && lowSurrogate <= 0xdfff) {
          codePoint = ((codePoint - 0xd800) << 10) + lowSurrogate - 0xdc00 + 0x10000;
          index += 1;
        } else {
          codePoint = 0xfffd;
        }
      } else {
        codePoint = 0xfffd;
      }
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    }
  }
  return new Uint8Array(bytes);
};

const concatenate = (parts: Uint8Array[]) => {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const createId3Frame = (id: string, payload: Uint8Array) => concatenate([
  encodeUtf8(id),
  writeSynchsafeInteger(payload.length),
  new Uint8Array([0, 0]),
  payload,
]);

const id3UserTextDescriptor = ({ id, payload }: Id3Frame) => {
  if (id !== 'TXXX' || payload.length < 2) return '';
  const encoding = payload[0];
  if (encoding === 0 || encoding === 3) {
    const descriptorEnd = payload.indexOf(0, 1);
    return descriptorEnd > 1 ? String.fromCharCode(...payload.subarray(1, descriptorEnd)) : '';
  }
  if (encoding !== 1 && encoding !== 2) return '';

  const descriptorBytes: number[] = [];
  let offset = encoding === 1 && payload[1] === 0xff && payload[2] === 0xfe ? 3 : 1;
  for (; offset + 1 < payload.length; offset += 2) {
    if (payload[offset] === 0 && payload[offset + 1] === 0) break;
    descriptorBytes.push(encoding === 1 ? payload[offset] : payload[offset + 1]);
  }
  return String.fromCharCode(...descriptorBytes);
};

const isLyricsDescriptor = (descriptor: string) => {
  const normalized = descriptor.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.includes('lyric') || normalized === 'lrc' || normalized.includes('ttml');
};

const isMusiqappLyricsFrame = (frame: Id3Frame) => (
  id3UserTextDescriptor(frame) === MUSIQAPP_LYRICS_DESCRIPTOR
);

const isLyricsFrame = (frame: Id3Frame) => (
  frame.id === 'USLT'
  || frame.id === 'SYLT'
  || isMusiqappLyricsFrame(frame)
  || isLyricsDescriptor(id3UserTextDescriptor(frame))
);

export const readEmbeddedMp3Lyrics = (
  native: Record<string, { id: string; value: unknown }[]>,
): EmbeddedMp3LyricsPayload | null => {
  const frame = Object.values(native).flat().find((tag) => tag.id === `TXXX:${MUSIQAPP_LYRICS_DESCRIPTOR}`);
  const raw = Array.isArray(frame?.value)
    ? frame.value.find((value): value is string => typeof value === 'string')
    : typeof frame?.value === 'string' ? frame.value : undefined;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<EmbeddedMp3LyricsPayload>;
    if (
      parsed.version !== 1
      || !['ttml', 'line', 'plain'].includes(parsed.format ?? '')
      || typeof parsed.text !== 'string'
      || !parsed.text.trim()
    ) return null;
    return parsed as EmbeddedMp3LyricsPayload;
  } catch {
    return null;
  }
};

const parseId3Frames = (source: Uint8Array): { frames: Id3Frame[]; audioOffset: number } => {
  if (source.length < 3 || source[0] !== 0x49 || source[1] !== 0x44 || source[2] !== 0x33) {
    return { frames: [], audioOffset: 0 };
  }
  if (source.length < 10) throw new Error('The MP3 has a truncated ID3 header.');

  const majorVersion = source[3];
  if (majorVersion !== 3 && majorVersion !== 4) {
    throw new Error('This MP3 uses an ID3 version that cannot be safely updated. The original file was not changed.');
  }
  if (source[5] !== 0) {
    throw new Error('This MP3 uses advanced ID3 tag options that cannot be safely preserved. The original file was not changed.');
  }

  const tagSize = readSynchsafeInteger(source, 6);
  const tagEnd = 10 + tagSize;
  if (tagEnd > source.length) throw new Error('The MP3 has a truncated ID3 tag.');

  const frames: Id3Frame[] = [];
  let offset = 10;
  while (offset < tagEnd) {
    if (source[offset] === 0) break;
    if (offset + 10 > tagEnd) throw new Error('The MP3 contains a truncated ID3 frame header.');

    const id = String.fromCharCode(source[offset], source[offset + 1], source[offset + 2], source[offset + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) throw new Error('The MP3 contains an invalid ID3 frame identifier.');
    if (source[offset + 8] !== 0 || source[offset + 9] !== 0) {
      throw new Error(`The MP3 contains an ID3 ${id} frame with unsupported flags. The original file was not changed.`);
    }

    const frameSize = majorVersion === 3
      ? readBigEndianInteger(source, offset + 4)
      : readSynchsafeInteger(source, offset + 4);
    const payloadStart = offset + 10;
    const payloadEnd = payloadStart + frameSize;
    if (!Number.isSafeInteger(payloadEnd) || payloadEnd > tagEnd) {
      throw new Error(`The MP3 contains a truncated ID3 ${id} frame.`);
    }
    frames.push({ id, payload: source.slice(payloadStart, payloadEnd) });
    offset = payloadEnd;
  }

  return { frames, audioOffset: tagEnd };
};

const createSyltFrame = (entries: SynchronizedLyricEntry[]) => {
  const payloadParts: Uint8Array[] = [
    new Uint8Array([3]),
    new Uint8Array([0x65, 0x6e, 0x67]),
    new Uint8Array([2]),
    new Uint8Array([1]),
    encodeUtf8(SYNCHRONIZER_DESCRIPTOR),
    new Uint8Array([0]),
  ];

  entries.forEach((entry) => {
    payloadParts.push(encodeUtf8(entry.text), new Uint8Array([0]), writeBigEndianInteger(entry.timestampMs));
  });

  const payload = concatenate(payloadParts);
  return createId3Frame('SYLT', payload);
};

const createMusiqappLyricsFrame = (lyrics: EmbeddedMp3LyricsPayload) => createId3Frame('TXXX', concatenate([
  new Uint8Array([3]),
  encodeUtf8(MUSIQAPP_LYRICS_DESCRIPTOR),
  new Uint8Array([0]),
  encodeUtf8(JSON.stringify(lyrics)),
]));

const createId3TagWithFrames = (sourceTag: Uint8Array, extraFrames: Uint8Array[]) => {
  const { frames } = parseId3Frames(sourceTag);
  const frameBytes: Uint8Array[] = frames.filter((frame) => !isLyricsFrame(frame))
    .map(({ id, payload }) => createId3Frame(id, payload));
  frameBytes.push(...extraFrames);
  const frameData = concatenate(frameBytes);
  const header = concatenate([
    new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]),
    writeSynchsafeInteger(frameData.length),
  ]);
  return concatenate([header, frameData]);
};

const createId3Tag = (sourceTag: Uint8Array, entries: SynchronizedLyricEntry[]) => (
  createId3TagWithFrames(sourceTag, [createSyltFrame(entries)])
);

const createId3TagWithMusiqappLyrics = (sourceTag: Uint8Array, lyrics: EmbeddedMp3LyricsPayload) => (
  createId3TagWithFrames(sourceTag, [createMusiqappLyricsFrame(lyrics)])
);

const createId3TagWithoutLyrics = (sourceTag: Uint8Array) => {
  return createId3TagWithFrames(sourceTag, []);
};

const readMetadataSample = async (file: File) => {
  const size = file.size ?? 0;
  if (size < 10) throw new Error('The MP3 is too small to contain a valid audio file.');
  const handle = file.open(FileMode.ReadOnly);
  try {
    const header = await handle.readBytes(10);
    let sampleLength = Math.min(size, 128 * 1024);
    if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
      const tagEnd = 10 + readSynchsafeInteger(header, 6);
      if (tagEnd > size) throw new Error('The MP3 has a truncated ID3 tag.');
      sampleLength = Math.min(size, tagEnd + 128 * 1024);
    }
    handle.offset = 0;
    return await handle.readBytes(sampleLength);
  } finally {
    handle.close();
  }
};

const collectFrames = (metadata: Awaited<ReturnType<typeof parseBuffer>>, frameId: string) => (
  Object.values(metadata.native).flatMap((frames) => frames.filter((frame) => frame.id === frameId))
);

const collectLyricsUserTextFrames = (metadata: Awaited<ReturnType<typeof parseBuffer>>) => (
  Object.values(metadata.native).flatMap((frames) => frames.filter((frame) => (
    frame.id.startsWith('TXXX:') && isLyricsDescriptor(frame.id.slice('TXXX:'.length))
  )))
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const verifyOutput = async (output: File, expected: SynchronizedLyricEntry[]) => {
  if (!output.exists || (output.size ?? 0) === 0) throw new Error('The synchronized MP3 file could not be created.');
  const metadata = await parseBuffer(await readMetadataSample(output), 'audio/mpeg');
  if (
    collectFrames(metadata, 'USLT').length !== 0
    || collectFrames(metadata, 'SYLT').length !== 1
    || collectLyricsUserTextFrames(metadata).length !== 0
    || readEmbeddedMp3Lyrics(metadata.native)
  ) {
    throw new Error('The exported file contains conflicting lyric metadata frames. Nothing was exported.');
  }

  const syltFrame = collectFrames(metadata, 'SYLT').find((frame) => {
    const value = frame.value;
    return isRecord(value) && value.descriptor === SYNCHRONIZER_DESCRIPTOR;
  });
  if (!syltFrame || !isRecord(syltFrame.value) || !Array.isArray(syltFrame.value.syncText)) {
    throw new Error('The exported file is missing its synchronized lyrics frame.');
  }

  const value = syltFrame.value;
  if (value.language !== 'eng' || value.contentType !== 1 || value.timeStampFormat !== 2 || !Array.isArray(value.syncText)) {
    throw new Error('The exported synchronized lyrics frame has invalid ID3 settings.');
  }
  const actual = value.syncText.map((line) => (
    isRecord(line) && 'text' in line && 'timestamp' in line
      ? { text: line.text, timestampMs: line.timestamp }
      : null
  ));
  if (
    actual.length !== expected.length
    || actual.some((entry, index) => entry === null
      || entry.text !== expected[index].text
      || entry.timestampMs !== expected[index].timestampMs)
  ) {
    throw new Error('The exported lyric timestamps did not match. Nothing was exported.');
  }
};

const verifyLyricsRemoved = async (output: File) => {
  if (!output.exists || (output.size ?? 0) === 0) throw new Error('The cleaned MP3 file could not be created.');
  const metadata = await parseBuffer(await readMetadataSample(output), 'audio/mpeg');
  const hasNativeLyrics = Object.values(metadata.native).some((frames) => (
    frames.some((frame) => frame.id === 'USLT' || frame.id === 'SYLT')
  ));
  if (
    hasNativeLyrics
    || collectLyricsUserTextFrames(metadata).length !== 0
    || readEmbeddedMp3Lyrics(metadata.native)
    || metadata.common.lyrics?.some((entry) => Boolean(entry.text?.trim() || entry.syncText?.length))
  ) {
    throw new Error('Lyrics remain in another embedded metadata tag. The original MP3 was not changed.');
  }
};

const rewriteMp3 = async (
  sourceUri: string,
  sourceFileName: string,
  suffix: string,
  createTag: (sourceTag: Uint8Array) => Uint8Array,
  verify: (output: File) => Promise<void>,
) => {
  const source = new File(sourceUri);
  if (!source.exists || (source.size ?? 0) === 0) throw new Error('The original MP3 is no longer available.');
  const sourceHandle = source.open(FileMode.ReadOnly);
  let sourceTag: Uint8Array;
  let audioOffset: number;
  try {
    const sourceHeader = await sourceHandle.readBytes(10);
    if (sourceHeader[0] === 0x49 && sourceHeader[1] === 0x44 && sourceHeader[2] === 0x33) {
      audioOffset = 10 + readSynchsafeInteger(sourceHeader, 6);
      sourceHandle.offset = 0;
      sourceTag = await sourceHandle.readBytes(audioOffset);
      if (sourceTag.length !== audioOffset) throw new Error('The MP3 has a truncated ID3 tag.');
    } else {
      audioOffset = 0;
      sourceTag = new Uint8Array();
    }
  } finally {
    sourceHandle.close();
  }

  const outputTag = createTag(sourceTag);
  if (!OUTPUT_DIRECTORY.exists) OUTPUT_DIRECTORY.create({ idempotent: true, intermediates: true });
  const baseName = safeFileName(sourceFileName.replace(/\.mp3$/i, ''));
  const output = new File(OUTPUT_DIRECTORY, `${baseName}-${suffix}-${Date.now()}.mp3`);
  try {
    output.create({ intermediates: true });
    output.write(outputTag);
    const inputHandle = source.open(FileMode.ReadOnly);
    try {
      inputHandle.offset = audioOffset;
      let remainingBytes = (source.size ?? 0) - audioOffset;
      while (remainingBytes > 0) {
        const chunk = await inputHandle.readBytes(Math.min(1024 * 1024, remainingBytes));
        if (chunk.length === 0) throw new Error('The original MP3 could not be copied completely.');
        output.write(chunk, { append: true });
        remainingBytes -= chunk.length;
      }
    } finally {
      inputHandle.close();
    }
    await verify(output);
    return output;
  } catch (error) {
    if (output.exists) output.delete();
    throw error;
  }
};

const safeFileName = (value: string) => value
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  .replace(/[. ]+$/g, '')
  .trim() || 'Synchronized track';

export const Id3SynchronizedLyricsService = {
  async createVerifiedMp3(
    sourceUri: string,
    sourceFileName: string,
    entries: SynchronizedLyricEntry[],
    trackDurationMs: number,
  ) {
    if (entries.length === 0) throw new Error('Add and synchronize at least one lyric line before saving.');
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry.text.trim() || !Number.isSafeInteger(entry.timestampMs) || entry.timestampMs < 0 || entry.timestampMs > 0xffffffff) {
        throw new Error(`Lyric line ${index + 1} has invalid text or timestamp.`);
      }
      if (entry.text.includes('\u0000')) throw new Error(`Lyric line ${index + 1} contains a character ID3 cannot store.`);
      if (index > 0 && entry.timestampMs < entries[index - 1].timestampMs) {
        throw new Error(`Timestamp for line ${index + 1} is earlier than the previous line. Adjust the line before saving.`);
      }
      if (trackDurationMs > 0 && entry.timestampMs > trackDurationMs) {
        throw new Error(`Timestamp for line ${index + 1} is beyond the end of the track.`);
      }
    }

    return rewriteMp3(
      sourceUri,
      sourceFileName,
      'synchronized',
      (sourceTag) => createId3Tag(sourceTag, entries),
      (output) => verifyOutput(output, entries),
    );
  },

  async createVerifiedMp3WithLyrics(
    sourceUri: string,
    sourceFileName: string,
    lyrics: EmbeddedMp3LyricsPayload,
  ) {
    if (!lyrics.text.trim()) throw new Error('Add lyrics before embedding them in the MP3.');
    if (!['ttml', 'line', 'plain'].includes(lyrics.format)) {
      throw new Error('This lyric format cannot be embedded in the MP3.');
    }

    const payload = { ...lyrics, version: 1 as const };
    return rewriteMp3(
      sourceUri,
      sourceFileName,
      'lyrics-embedded',
      (sourceTag) => createId3TagWithMusiqappLyrics(sourceTag, payload),
      async (output) => {
        if (!output.exists || (output.size ?? 0) === 0) throw new Error('The MP3 with embedded lyrics could not be created.');
        const metadata = await parseBuffer(await readMetadataSample(output), 'audio/mpeg');
        const embedded = readEmbeddedMp3Lyrics(metadata.native);
        if (
          !embedded
          || collectFrames(metadata, 'USLT').length !== 0
          || collectFrames(metadata, 'SYLT').length !== 0
          || collectLyricsUserTextFrames(metadata).length !== 1
          || embedded.format !== payload.format
          || embedded.text !== payload.text
          || embedded.source !== payload.source
          || JSON.stringify(embedded.attribution) !== JSON.stringify(payload.attribution)
        ) {
          throw new Error('The embedded lyrics could not be verified. The original MP3 was not changed.');
        }
      },
    );
  },

  async createVerifiedMp3WithoutLyrics(sourceUri: string, sourceFileName: string) {
    return rewriteMp3(
      sourceUri,
      sourceFileName,
      'lyrics-removed',
      createId3TagWithoutLyrics,
      verifyLyricsRemoved,
    );
  },

  async restoreLatestSynchronizedMp3(sourceFileName: string, destinationUri: string) {
    if (!OUTPUT_DIRECTORY.exists) return null;
    const baseName = safeFileName(sourceFileName.replace(/\.mp3$/i, ''));
    const prefix = `${baseName}-synchronized-`;
    const candidates = OUTPUT_DIRECTORY.list()
      .filter((item): item is File => item instanceof File
        && item.name.startsWith(prefix)
        && item.extension.toLowerCase() === '.mp3')
      .sort((first, second) => second.name.localeCompare(first.name));

    for (const candidate of candidates) {
      try {
        const metadata = await parseBuffer(await readMetadataSample(candidate), 'audio/mpeg');
        const frame = collectFrames(metadata, 'SYLT').find((item) => {
          const value = item.value;
          return isRecord(value) && value.descriptor === SYNCHRONIZER_DESCRIPTOR;
        });
        if (!frame || !isRecord(frame.value)) continue;
        const value = frame.value;
        if (
          value.language !== 'eng'
          || value.contentType !== 1
          || value.timeStampFormat !== 2
          || !Array.isArray(value.syncText)
          || value.syncText.length === 0
          || !value.syncText.every((entry) => isRecord(entry)
            && typeof entry.text === 'string'
            && typeof entry.timestamp === 'number'
            && Number.isFinite(entry.timestamp))
        ) continue;

        const destination = new File(destinationUri);
        await candidate.copy(destination, { overwrite: true });
        if (destination.exists && destination.size === candidate.size) return destination;
      } catch {
        // Try an older prepared copy if the newest one is incomplete.
      }
    }

    return null;
  },

  async copyToDirectory(verifiedMp3: File, destinationDirectory: Directory, sourceFileName: string, entries: SynchronizedLyricEntry[]) {
    const baseName = `${safeFileName(sourceFileName.replace(/\.mp3$/i, ''))} (synchronized)`;
    let outputName = `${baseName}.mp3`;
    let suffix = 2;
    while (new File(destinationDirectory, outputName).exists) {
      outputName = `${baseName} (${suffix}).mp3`;
      suffix += 1;
    }

    const destination = new File(destinationDirectory, outputName);
    await verifiedMp3.copy(destination);
    try {
      await verifyOutput(destination, entries);
      return destination;
    } catch (error) {
      if (destination.exists) destination.delete();
      throw error;
    }
  },
};
