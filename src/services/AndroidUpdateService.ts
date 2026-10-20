import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { File, Paths } from 'expo-file-system';
import { createDownloadResumable, getContentUriAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const RELEASE_API_URL = 'https://api.github.com/repos/egokam/MusicLocal/releases/latest';
const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const GRANT_READ_URI_PERMISSION = 1;

export type AndroidUpdate = {
  version: string;
  title: string;
  notes: string;
  downloadUrl: string;
  releaseUrl: string;
  sizeBytes: number | null;
};

type GitHubRelease = {
  tag_name?: string;
  name?: string;
  body?: string | null;
  html_url?: string;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
    size?: number;
  }>;
};

const currentVersion = () => Constants.expoConfig?.version ?? '0.0.0';

const parseVersion = (value: string) => {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
};

const isNewerVersion = (candidate: string, installed: string) => {
  const next = parseVersion(candidate);
  const current = parseVersion(installed);
  if (!next || !current) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return false;
};

export const AndroidUpdateService = {
  async checkForUpdate(): Promise<AndroidUpdate | null> {
    if (Platform.OS !== 'android') return null;

    const response = await fetch(RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) return null;

    const release = await response.json() as GitHubRelease;
    const version = release.tag_name?.trim() || '';
    const apk = release.assets?.find((asset) => asset.name?.toLowerCase().endsWith('.apk'));
    if (!version || !apk?.browser_download_url || !isNewerVersion(version, currentVersion())) return null;

    return {
      version: version.replace(/^v/i, ''),
      title: release.name?.trim() || `Musiqapp ${version}`,
      notes: release.body?.trim() || '',
      downloadUrl: apk.browser_download_url,
      releaseUrl: release.html_url || 'https://github.com/egokam/MusicLocal/releases/latest',
      sizeBytes: typeof apk.size === 'number' ? apk.size : null,
    };
  },

  async downloadUpdate(update: AndroidUpdate, onProgress: (progress: number | null) => void): Promise<string> {
    if (Platform.OS !== 'android') throw new Error('Android updates are only available on Android.');

    const destination = new File(Paths.cache, `musiqapp-update-${update.version}.apk`);
    if (destination.exists) destination.delete();

    const resumable = createDownloadResumable(
      update.downloadUrl,
      destination.uri,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        onProgress(totalBytesExpectedToWrite > 0
          ? Math.min(1, totalBytesWritten / totalBytesExpectedToWrite)
          : null);
      },
    );
    const result = await resumable.downloadAsync();
    if (!result?.uri) throw new Error('The update download did not produce an APK file.');
    onProgress(1);
    return result.uri;
  },

  async installUpdate(fileUri: string): Promise<void> {
    if (Platform.OS !== 'android') return;
    const contentUri = await getContentUriAsync(fileUri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: APK_MIME_TYPE,
      flags: GRANT_READ_URI_PERMISSION,
    });
  },

  async openInstallPermissionSettings(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const packageName = Constants.expoConfig?.android?.package;
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
      ...(packageName ? { data: `package:${packageName}` } : {}),
    });
  },
};
