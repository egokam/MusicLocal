import * as BackgroundTask from 'expo-background-task';
import { Directory, File, Paths } from 'expo-file-system';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import type { LrcCheckState } from '../components/library/LrcCheckerRow';
import type { Track } from '../types';
import { lyricsCandidateSignature, MusicCatalogService } from './MusicCatalogService';

const BACKGROUND_TASK_NAME = 'musiqapp-lrc-scan';
const BACKGROUND_BATCH_SIZE = 24;
const BACKGROUND_MINIMUM_INTERVAL_MINUTES = 15;
const storageDirectory = new Directory(Paths.document, 'musiqapp-lyrics');
const storageFile = new File(storageDirectory, 'lrc-checker.json');

export type LrcCheckerRecord = {
  state: LrcCheckState;
  result?: Track;
  error?: string;
  excludedCandidateSignatures?: string[];
  previousResults?: Track[];
};

const MAX_PREVIOUS_RESULTS = 10;

export type LrcCheckerSnapshot = {
  records: Record<string, LrcCheckerRecord>;
  isScanning: boolean;
  isLoadingCatalog: boolean;
  isStopping: boolean;
  progress: { completed: number; total: number };
  scanError: string | null;
};

type PersistedLrcCheckerState = LrcCheckerSnapshot & {
  version: 1;
  scanTracks: Track[];
};

type ScanCallbacks = {
  loadAllTracks: () => Promise<Track[]>;
  checkTrack: (track: Track, forceOnline?: boolean, excludedCandidateSignatures?: string[]) => Promise<Track>;
};

const EMPTY_SNAPSHOT: LrcCheckerSnapshot = {
  records: {},
  isScanning: false,
  isLoadingCatalog: false,
  isStopping: false,
  progress: { completed: 0, total: 0 },
  scanError: null,
};

const isTimedLrc = (value: string | undefined) => Boolean(
  value?.match(/^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*\S/m),
);

const minimalTrack = (track: Track): Track => ({
  id: track.id,
  title: track.title,
  artist: track.artist,
  album: track.album,
  duration: track.duration,
  durationSeconds: track.durationSeconds,
  artwork: track.artwork,
  provider: track.provider,
  providerId: track.providerId,
  lyricsAvailable: track.lyricsAvailable,
  hasSyncedLyrics: track.hasSyncedLyrics,
  hasPlainLyrics: track.hasPlainLyrics,
  lyricsSource: track.lyricsSource,
  lyricsAttribution: track.lyricsAttribution,
  lyricsFormat: track.lyricsFormat,
  lyricsTtml: track.lyricsTtml,
  lyricsLookupProviders: track.lyricsLookupProviders,
  lyricsLookupIssues: track.lyricsLookupIssues,
  lyricsQualityWarning: track.lyricsQualityWarning,
  syncedLyrics: track.syncedLyrics,
  plainLyrics: track.plainLyrics,
  lyrics: track.lyrics,
  localUri: track.localUri,
  lyricsFileUri: track.lyricsFileUri,
});

const isCompleteRecord = (record: LrcCheckerRecord | undefined) => Boolean(
  record && record.state !== 'unchecked' && record.state !== 'checking' && record.state !== 'error',
);

const copySnapshot = (state: PersistedLrcCheckerState): LrcCheckerSnapshot => ({
  records: { ...state.records },
  isScanning: state.isScanning,
  isLoadingCatalog: state.isLoadingCatalog,
  isStopping: state.isStopping,
  progress: { ...state.progress },
  scanError: state.scanError,
});

const makeDefaultPersistedState = (): PersistedLrcCheckerState => ({
  version: 1,
  ...EMPTY_SNAPSHOT,
  records: {},
  scanTracks: [],
});

let persistedState = makeDefaultPersistedState();
let hydrated = false;
let hydrationPromise: Promise<void> | undefined;
let writeQueue: Promise<void> = Promise.resolve();
let foregroundRun: Promise<void> | undefined;
let stopRequested = false;
let listeners = new Set<(snapshot: LrcCheckerSnapshot) => void>();

const notify = () => {
  const snapshot = copySnapshot(persistedState);
  listeners.forEach((listener) => listener(snapshot));
};

const ensureStorageDirectory = () => {
  if (!storageDirectory.exists) storageDirectory.create({ idempotent: true, intermediates: true });
};

const hydrate = async () => {
  if (hydrated) return;
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      ensureStorageDirectory();
      if (storageFile.exists) {
        try {
          const value = JSON.parse(await storageFile.text()) as Partial<PersistedLrcCheckerState>;
          const savedRecords = value.records && typeof value.records === 'object' ? value.records : {};
          persistedState = {
            version: 1,
            records: Object.fromEntries(Object.entries(savedRecords).map(([trackId, record]) => [
              trackId,
              record?.state === 'checking'
                ? { state: 'error', error: 'Lookup interrupted; it will be retried.' }
                : {
                    ...record,
                    excludedCandidateSignatures: Array.isArray(record?.excludedCandidateSignatures)
                      ? record.excludedCandidateSignatures.filter((signature): signature is string => typeof signature === 'string')
                      : undefined,
                    previousResults: Array.isArray(record?.previousResults)
                      ? record.previousResults.filter((track): track is Track => Boolean(track && typeof track.id === 'string')).map(minimalTrack)
                      : undefined,
                  },
            ])) as Record<string, LrcCheckerRecord>,
            isScanning: value.isScanning === true,
            isLoadingCatalog: value.isLoadingCatalog === true,
            isStopping: false,
            progress: {
              completed: Number.isFinite(value.progress?.completed) ? Number(value.progress?.completed) : 0,
              total: Number.isFinite(value.progress?.total) ? Number(value.progress?.total) : 0,
            },
            scanError: typeof value.scanError === 'string' ? value.scanError : null,
            scanTracks: Array.isArray(value.scanTracks) ? value.scanTracks : [],
          };
        } catch {
          persistedState = makeDefaultPersistedState();
        }
      }
      hydrated = true;
      notify();
    })();
  }
  await hydrationPromise;
};

const persist = async () => {
  ensureStorageDirectory();
  if (storageFile.exists) storageFile.delete();
  storageFile.create({ intermediates: true });
  storageFile.write(JSON.stringify(persistedState));
};

const updateState = async (mutate: (state: PersistedLrcCheckerState) => void) => {
  await hydrate();
  const operation = writeQueue.then(async () => {
    mutate(persistedState);
    await persist();
    notify();
  });
  writeQueue = operation.catch(() => undefined);
  await operation;
};

const setRecord = async (trackId: string, record: LrcCheckerRecord) => {
  await updateState((state) => {
    const previous = state.records[trackId];
    state.records[trackId] = {
      ...record,
      excludedCandidateSignatures: record.excludedCandidateSignatures ?? previous?.excludedCandidateSignatures,
      result: record.result ? minimalTrack(record.result) : undefined,
      previousResults: (record.previousResults ?? previous?.previousResults)?.slice(-MAX_PREVIOUS_RESULTS).map(minimalTrack),
    };
    if (state.scanTracks.length > 0) {
      state.progress.completed = state.scanTracks.filter((track) => isCompleteRecord(state.records[track.id])).length;
      state.progress.total = state.scanTracks.length;
    }
  });
};

const setSessionTracks = async (tracks: Track[]) => {
  const uniqueTracks = [...new Map(tracks.map((track) => [track.id, minimalTrack(track)])).values()];
  await updateState((state) => {
    state.scanTracks = uniqueTracks;
    for (const track of uniqueTracks) {
      const previous = state.records[track.id];
      state.records[track.id] = {
        state: 'unchecked',
        excludedCandidateSignatures: previous?.excludedCandidateSignatures,
        previousResults: previous?.previousResults,
      };
    }
    state.progress.total = uniqueTracks.length;
    state.progress.completed = 0;
    state.isScanning = true;
    state.isLoadingCatalog = false;
    state.isStopping = false;
    state.scanError = null;
  });
};

const setScanStatus = async (patch: Partial<Pick<LrcCheckerSnapshot, 'isScanning' | 'isLoadingCatalog' | 'isStopping' | 'scanError'>>) => {
  await updateState((state) => {
    Object.assign(state, patch);
  });
};

const registerBackgroundTask = async () => {
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME))) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_NAME, {
        minimumInterval: BACKGROUND_MINIMUM_INTERVAL_MINUTES,
      });
    }
  } catch {
    // Foreground scanning still works when the OS or preview client disallows background work.
  }
};

const unregisterBackgroundTask = async () => {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME)) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK_NAME);
    }
  } catch {
    // Ignore clients that do not expose the native task scheduler.
  }
};

const recordFromResult = (result: Track): LrcCheckerRecord => {
  const hasTimedLyrics = isTimedLrc(result.syncedLyrics)
    || result.lyrics?.some((line) => line.timeMs !== null && line.text.trim());
  const hasPlainLyrics = Boolean(result.plainLyrics?.trim() || result.lyrics?.some((line) => line.text.trim()));
  const isLocal = ['local_ttml', 'local_lrc', 'local_text', 'embedded_lrc', 'embedded_text', 'embedded_musiqapp', 'saved_lrc']
    .includes(result.lyricsSource ?? '');
  const isSpicyCache = result.lyricsSource === 'spicy_lyrics_api';
  const isCandidate = hasTimedLyrics || hasPlainLyrics;
  const issues = result.lyricsLookupIssues ?? [];

  if (issues.length && isCandidate && !isLocal) {
    return { state: 'candidate', result, error: issues.join(' ') };
  }
  if (issues.length && !isCandidate) {
    return {
      state: 'error',
      error: issues.join(' '),
    };
  }

  if (isLocal) return { state: hasTimedLyrics ? 'synced' : hasPlainLyrics ? 'plain' : 'missing' };
  if (isSpicyCache) return { state: hasTimedLyrics ? 'synced' : hasPlainLyrics ? 'plain' : 'missing', result };
  if (isCandidate) return { state: 'candidate', result, ...(issues.length ? { error: issues.join(' ') } : {}) };
  if (issues.length) return { state: 'error', error: issues.join(' ') };
  return { state: 'missing' };
};

const isSessionFinished = () => persistedState.scanTracks.every((track) => {
  const state = persistedState.records[track.id]?.state;
  return Boolean(state && state !== 'checking' && state !== 'unchecked');
});

const finishSession = async () => {
  await setScanStatus({ isScanning: false, isLoadingCatalog: false, isStopping: false });
  await unregisterBackgroundTask();
};

const runForegroundScan = async (callbacks: ScanCallbacks) => {
  if (foregroundRun) return foregroundRun;
  foregroundRun = (async () => {
    stopRequested = false;
    try {
      await setScanStatus({ isScanning: true, isLoadingCatalog: true, isStopping: false, scanError: null });
      await setSessionTracks([]);
      await registerBackgroundTask();
      const tracks = await callbacks.loadAllTracks();
      await setSessionTracks(tracks);

      for (const track of tracks) {
        if (stopRequested) break;
        await setRecord(track.id, { state: 'checking' });
        try {
          const result = await callbacks.checkTrack(track, true);
          await setRecord(track.id, recordFromResult(result));
        } catch (error) {
          await setRecord(track.id, {
            state: 'error',
            error: error instanceof Error ? error.message : 'The lyrics service request failed. Try again later.',
          });
        }
        if (!stopRequested) await new Promise((resolve) => setTimeout(resolve, 350));
      }

      if (isSessionFinished() || stopRequested) await finishSession();
    } catch (error) {
      await setScanStatus({ isLoadingCatalog: false, scanError: error instanceof Error ? error.message : 'Could not load the whole music library.' });
      await finishSession();
    } finally {
      foregroundRun = undefined;
    }
  })();
  return foregroundRun;
};

const runBackgroundBatch = async () => {
  await hydrate();
  if (!persistedState.isScanning || foregroundRun) return;

  if (persistedState.scanTracks.length === 0) {
    await setSessionTracks(await MusicCatalogService.searchAllTracks());
  }

  let expired = false;
  const expirationSubscription = Platform.OS === 'ios'
    ? BackgroundTask.addExpirationListener(() => { expired = true; })
    : undefined;

  try {
    let processed = 0;
    for (const track of persistedState.scanTracks) {
      if (expired || processed >= BACKGROUND_BATCH_SIZE) break;
      await setRecord(track.id, { state: 'checking' });
      try {
        const result = await MusicCatalogService.searchLyricsForChecker(track);
        await setRecord(track.id, recordFromResult(result));
      } catch (error) {
        await setRecord(track.id, {
          state: 'error',
          error: error instanceof Error ? error.message : 'The lyrics service request failed. Try again later.',
        });
      }
      processed += 1;
    }

    if (isSessionFinished()) await finishSession();
  } finally {
    expirationSubscription?.remove();
  }
};

if (Platform.OS !== 'web') {
  TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
    try {
      await runBackgroundBatch();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export const LrcCheckerService = {
  hydrate,

  getSnapshot(): LrcCheckerSnapshot {
    return copySnapshot(persistedState);
  },

  subscribe(listener: (snapshot: LrcCheckerSnapshot) => void) {
    listeners.add(listener);
    listener(copySnapshot(persistedState));
    return () => listeners.delete(listener);
  },

  async startScan(loadAllTracks: () => Promise<Track[]>, checkTrack: (track: Track, forceOnline?: boolean, excludedCandidateSignatures?: string[]) => Promise<Track>) {
    await hydrate();
    if (foregroundRun) return foregroundRun;
    return runForegroundScan({ loadAllTracks, checkTrack });
  },

  async checkTrack(track: Track, check: (track: Track, forceOnline?: boolean) => Promise<Track>) {
    await hydrate();
    await setRecord(track.id, { state: 'checking' });
    try {
      const result = await check(track, true);
      const record = recordFromResult(result);
      await setRecord(track.id, record);
      return { ...record, result: record.result ?? result };
    } catch (error) {
      const record: LrcCheckerRecord = {
        state: 'error',
        error: error instanceof Error ? error.message : 'The lyrics service request failed. Try again later.',
      };
      await setRecord(track.id, record);
      throw error;
    }
  },

  async retryTrack(
    track: Track,
    check: (track: Track, forceOnline?: boolean, excludedCandidateSignatures?: string[]) => Promise<Track>,
  ): Promise<LrcCheckerRecord> {
    await hydrate();
    const previous = persistedState.records[track.id];
    const excluded = new Set(previous?.excludedCandidateSignatures ?? []);
    const previousSignature = previous?.result ? lyricsCandidateSignature(previous.result) : '';
    if (previousSignature) excluded.add(previousSignature);
    const excludedCandidateSignatures = [...excluded];

    await setRecord(track.id, {
      state: 'checking',
      result: previous?.result,
      excludedCandidateSignatures,
      previousResults: previous?.previousResults,
    });
    try {
      const result = await check(track, true, excludedCandidateSignatures);
      const record = recordFromResult(result);
      const resultSignature = lyricsCandidateSignature(result);
      const isDistinctResult = Boolean(resultSignature && resultSignature !== previousSignature);
      const previousResults = isDistinctResult && previous?.result
        ? [...(previous.previousResults ?? []), previous.result].slice(-MAX_PREVIOUS_RESULTS)
        : previous?.previousResults;
      const retryRecord: LrcCheckerRecord = isDistinctResult
        ? {
            ...record,
            result,
            excludedCandidateSignatures,
            previousResults,
          }
        : previous?.result
          ? {
              ...recordFromResult(previous.result),
              result: previous.result,
              error: record.error || 'No different lyrics version was found. Previous results were skipped.',
              excludedCandidateSignatures,
              previousResults: previous.previousResults,
            }
          : { ...record, excludedCandidateSignatures, previousResults };
      await setRecord(track.id, retryRecord);
      return retryRecord;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The lyrics service request failed. Try again later.';
      const retryRecord: LrcCheckerRecord = previous?.result
        ? {
            ...recordFromResult(previous.result),
            result: previous.result,
            error: message,
            excludedCandidateSignatures,
            previousResults: previous.previousResults,
          }
        : { state: 'error', error: message, excludedCandidateSignatures, previousResults: previous?.previousResults };
      await setRecord(track.id, retryRecord);
      throw error;
    }
  },

  async undoRetry(trackId: string): Promise<LrcCheckerRecord | null> {
    await hydrate();
    const current = persistedState.records[trackId];
    const history = current?.previousResults ?? [];
    const previousResult = history[history.length - 1];
    if (!current || !previousResult) return null;

    const previousSignature = lyricsCandidateSignature(previousResult);
    const excludedCandidateSignatures = (current.excludedCandidateSignatures ?? [])
      .filter((signature) => signature !== previousSignature);
    const restored: LrcCheckerRecord = {
      ...recordFromResult(previousResult),
      result: previousResult,
      excludedCandidateSignatures,
      previousResults: history.slice(0, -1),
    };
    await setRecord(trackId, restored);
    return restored;
  },

  async updateRecord(trackId: string, record: LrcCheckerRecord) {
    await hydrate();
    const previous = persistedState.records[trackId];
    await setRecord(trackId, {
      ...record,
      excludedCandidateSignatures: record.excludedCandidateSignatures ?? previous?.excludedCandidateSignatures,
      previousResults: record.previousResults ?? previous?.previousResults,
    });
  },

  async stopScan() {
    stopRequested = true;
    await setScanStatus({ isStopping: true });
    if (!foregroundRun) await finishSession();
  },

  async resumeIfNeeded() {
    await hydrate();
    if (!persistedState.isScanning || foregroundRun) return;
    const storedTracks = persistedState.scanTracks;
    await runForegroundScan({
      loadAllTracks: async () => {
        if (storedTracks.length > 0) return storedTracks;
        return MusicCatalogService.searchAllTracks();
      },
      checkTrack: (track) => MusicCatalogService.searchLyricsForChecker(track),
    });
  },
};
