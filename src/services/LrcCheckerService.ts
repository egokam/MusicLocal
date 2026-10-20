import * as BackgroundTask from 'expo-background-task';
import { Directory, File, Paths } from 'expo-file-system';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import type { LrcCheckState } from '../components/library/LrcCheckerRow';
import type { Track } from '../types';
import { MusicCatalogService } from './MusicCatalogService';

const BACKGROUND_TASK_NAME = 'musiqapp-lrc-scan';
const BACKGROUND_BATCH_SIZE = 24;
const BACKGROUND_MINIMUM_INTERVAL_MINUTES = 15;
const storageDirectory = new Directory(Paths.document, 'musiqapp-lyrics');
const storageFile = new File(storageDirectory, 'lrc-checker.json');

export type LrcCheckerRecord = {
  state: LrcCheckState;
  result?: Track;
  error?: string;
};

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
  checkTrack: (track: Track) => Promise<Track>;
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

const hasTimedLyrics = (track: Track) => Boolean(
  isTimedLrc(track.syncedLyrics)
  || track.lyrics?.some((line) => line.timeMs !== null && line.text.trim()),
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
                : record,
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
    state.records[trackId] = {
      ...record,
      result: record.result ? minimalTrack(record.result) : undefined,
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
    state.progress.total = uniqueTracks.length;
    state.progress.completed = uniqueTracks.filter((track) => isCompleteRecord(state.records[track.id])).length;
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

const getRecord = async (trackId: string) => {
  await hydrate();
  await writeQueue;
  return persistedState.records[trackId];
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
  if (isTimedLrc(result.syncedLyrics)) {
    const isAlreadyApplied = result.lyricsSource === 'local_lrc' || result.lyricsSource === 'embedded_lrc';
    return {
      state: isAlreadyApplied ? 'synced' : 'candidate',
      result: isAlreadyApplied ? undefined : result,
    };
  }
  return { state: result.plainLyrics?.trim() ? 'plain' : 'missing' };
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
        const existing = await getRecord(track.id);
        if (isCompleteRecord(existing)) continue;
        if (hasTimedLyrics(track)) {
          await setRecord(track.id, { state: 'synced' });
          continue;
        }
        await setRecord(track.id, { state: 'checking' });
        try {
          const result = await callbacks.checkTrack(track);
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
      const existing = await getRecord(track.id);
      if (isCompleteRecord(existing)) continue;
      if (hasTimedLyrics(track)) {
        await setRecord(track.id, { state: 'synced' });
        continue;
      }
      await setRecord(track.id, { state: 'checking' });
      try {
        const result = await MusicCatalogService.getLyrics(track, true);
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

  async startScan(loadAllTracks: () => Promise<Track[]>, checkTrack: (track: Track) => Promise<Track>) {
    await hydrate();
    if (foregroundRun) return foregroundRun;
    return runForegroundScan({ loadAllTracks, checkTrack });
  },

  async checkTrack(track: Track, check: (track: Track) => Promise<Track>) {
    await hydrate();
    await setRecord(track.id, { state: 'checking' });
    try {
      const result = await check(track);
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

  async updateRecord(trackId: string, record: LrcCheckerRecord) {
    await setRecord(trackId, record);
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
      checkTrack: (track) => MusicCatalogService.getLyrics(track, true),
    });
  },
};
