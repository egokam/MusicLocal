import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { AndroidUpdateService, type AndroidUpdate } from '../../services/AndroidUpdateService';

type PromptState = 'available' | 'downloading' | 'ready' | 'error';

export const AndroidUpdatePrompt = () => {
  const [update, setUpdate] = useState<AndroidUpdate | null>(null);
  const [state, setState] = useState<PromptState>('available');
  const [progress, setProgress] = useState<number | null>(0);
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    let cancelled = false;
    void AndroidUpdateService.checkForUpdate()
      .then((nextUpdate) => {
        if (!cancelled && nextUpdate) setUpdate(nextUpdate);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (Platform.OS !== 'android' || !update) return null;

  const download = async () => {
    if (state === 'downloading' || state === 'ready') return;
    setState('downloading');
    setProgress(0);
    setError(null);
    try {
      const uri = await AndroidUpdateService.downloadUpdate(update, setProgress);
      setDownloadedUri(uri);
      setState('ready');
    } catch (reason) {
      setState('error');
      setError(reason instanceof Error ? reason.message : 'Could not download the update.');
    }
  };

  const install = async () => {
    if (!downloadedUri) return;
    setError(null);
    try {
      await AndroidUpdateService.installUpdate(downloadedUri);
    } catch (reason) {
      setState('error');
      setError(reason instanceof Error ? reason.message : 'Android blocked the installation.');
    }
  };

  const openPermissionSettings = async () => {
    try {
      await AndroidUpdateService.openInstallPermissionSettings();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open Android install settings.');
    }
  };

  const isDownloading = state === 'downloading';

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Text style={styles.icon}>↑</Text>
          </View>
          <Text style={styles.title}>There is a new update available</Text>
          <Text style={styles.message}>Update to enjoy new features.</Text>
          <Text style={styles.version}>Musiqapp {update.version}</Text>

          {update.notes ? <Text numberOfLines={3} style={styles.notes}>{update.notes}</Text> : null}

          {isDownloading ? (
            <View style={styles.progressSection}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: progress === null ? '35%' : `${Math.round(progress * 100)}%` }]} />
              </View>
              <Text style={styles.progressText}>
                {progress === null ? 'Downloading…' : `Downloading ${Math.round(progress * 100)}%`}
              </Text>
            </View>
          ) : null}

          {state === 'ready' ? (
            <Pressable onPress={() => void install()} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Install update</Text>
            </Pressable>
          ) : (
            <Pressable disabled={isDownloading} onPress={() => void download()} style={[styles.primaryButton, isDownloading && styles.disabledButton]}>
              {isDownloading ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>Download</Text>}
            </Pressable>
          )}

          {error ? (
            <>
              <Text style={styles.error}>{error}</Text>
              <Pressable onPress={() => void openPermissionSettings()} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Open install settings</Text>
              </Pressable>
            </>
          ) : null}

          <Pressable disabled={isDownloading} onPress={() => setUpdate(null)} style={styles.dismissButton}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  card: {
    width: '100%',
    maxWidth: 390,
    borderRadius: 28,
    padding: 24,
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FA5265',
  },
  icon: { color: 'white', fontSize: 32, fontWeight: '800' },
  title: { color: 'white', fontSize: 24, fontWeight: '800', marginTop: 18 },
  message: { color: '#D1D1D6', fontSize: 16, lineHeight: 22, marginTop: 8 },
  version: { color: '#FA5265', fontSize: 14, fontWeight: '700', marginTop: 12 },
  notes: { color: '#A1A1A6', fontSize: 13, lineHeight: 18, marginTop: 12 },
  progressSection: { marginTop: 20 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: '#3A3A3C' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: '#FA5265' },
  progressText: { color: '#D1D1D6', fontSize: 13, marginTop: 8 },
  primaryButton: { minHeight: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 22, backgroundColor: '#FA5265' },
  disabledButton: { opacity: 0.65 },
  primaryButtonText: { color: 'white', fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 10, backgroundColor: '#2C2C2E' },
  secondaryButtonText: { color: '#FA5265', fontSize: 14, fontWeight: '700' },
  error: { color: '#FF8A8A', fontSize: 13, lineHeight: 18, marginTop: 12 },
  dismissButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  dismissText: { color: '#A1A1A6', fontSize: 15, fontWeight: '700' },
});
