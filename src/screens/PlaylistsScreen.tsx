import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SkeletonBlock, SkeletonPulse } from '../components/Skeleton';
import { getMusicApiHeaders } from '../services/MusicCatalogService';
import type { PlaylistCoverSelection, PlaylistSummary } from '../types';

export const PlaylistsScreen = ({
  onBack,
  playlists,
  loading,
  onCreate,
  onOpen,
  onDelete,
}: {
  onBack: () => void;
  playlists: PlaylistSummary[];
  loading: boolean;
  onCreate: (name: string, cover?: PlaylistCoverSelection) => Promise<PlaylistSummary>;
  onOpen: (playlist: PlaylistSummary) => void;
  onDelete: (playlistId: string) => Promise<void>;
}) => {
  const [name, setName] = useState('');
  const [cover, setCover] = useState<PlaylistCoverSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);

  const chooseCover = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset) setCover({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
    } catch (error) {
      Alert.alert('Could not open Photos', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const create = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || busy) return;
    setBusy(true);
    try {
      await onCreate(trimmedName, cover ?? undefined);
      setName('');
      setCover(null);
      setCreateVisible(false);
    } catch (error) {
      Alert.alert('Could not create playlist', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const closeCreate = () => {
    if (busy) return;
    setCreateVisible(false);
    setName('');
    setCover(null);
  };

  const confirmDelete = (playlist: PlaylistSummary) => {
    Alert.alert('Delete playlist?', `“${playlist.name}” will be deleted. Its tracks will stay in your library. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void onDelete(playlist.id).catch((error) => {
          Alert.alert('Could not delete playlist', error instanceof Error ? error.message : 'Try again.');
        }),
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <View style={{ paddingHorizontal: 20, paddingTop: 5, paddingBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={onBack} accessibilityLabel="Back" style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1E' }}>
          <Ionicons name="chevron-back" size={27} color="white" />
        </TouchableOpacity>
        <Text style={{ flex: 1, color: 'white', fontSize: 32, fontWeight: '800', marginLeft: 14 }}>Playlists</Text>
        <TouchableOpacity
          onPress={() => setCreateVisible(true)}
          accessibilityLabel="Create playlist"
          style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1E' }}
        >
          <Ionicons name="add" size={27} color="#FA5265" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 190 }}>
        <Text style={{ color: '#A1A1A6', fontSize: 15, lineHeight: 22, marginTop: 4, marginBottom: 20 }}>
          Your playlists and covers stay on this phone.
        </Text>

        {loading ? (
          <SkeletonPulse style={{ marginTop: 4 }}>
            {[0, 1, 2, 3, 4].map((index) => (
              <View key={index} style={{ minHeight: 82, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 19, backgroundColor: '#1C1C1E', flexDirection: 'row', alignItems: 'center' }}>
                <SkeletonBlock style={{ width: 58, height: 58, borderRadius: 12 }} />
                <View style={{ flex: 1, marginLeft: 13 }}>
                  <SkeletonBlock style={{ width: `${index % 2 === 0 ? 67 : 49}%`, height: 15, borderRadius: 8 }} />
                  <SkeletonBlock style={{ width: '28%', height: 11, borderRadius: 6, marginTop: 9 }} />
                </View>
              </View>
            ))}
          </SkeletonPulse>
        ) : null}
        {!loading && playlists.length === 0 ? (
          <TouchableOpacity
            onPress={() => setCreateVisible(true)}
            style={{ marginTop: 16, padding: 24, borderRadius: 22, backgroundColor: '#1C1C1E', alignItems: 'center' }}
          >
            <Ionicons name="musical-notes-outline" size={34} color="#FA5265" />
            <Text style={{ color: 'white', fontSize: 17, fontWeight: '700', marginTop: 12 }}>Create your first playlist</Text>
            <Text style={{ color: '#A1A1A6', fontSize: 14, textAlign: 'center', marginTop: 6 }}>
              Add a name and choose a cover from Photos.
            </Text>
          </TouchableOpacity>
        ) : null}

        {playlists.map((playlist) => {
          const artwork = playlist.coverUri
            ? { uri: playlist.coverUri }
            : playlist.coverUrl
              ? { uri: playlist.coverUrl, headers: getMusicApiHeaders() }
              : null;
          return (
            <View key={playlist.id} style={{ minHeight: 82, marginBottom: 10, paddingLeft: 12, paddingRight: 8, borderRadius: 19, backgroundColor: '#1C1C1E', flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={() => onOpen(playlist)} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                {artwork ? (
                  <Image source={artwork} style={{ width: 58, height: 58, borderRadius: 12, backgroundColor: '#2C2C2E' }} />
                ) : (
                  <View style={{ width: 58, height: 58, borderRadius: 12, backgroundColor: '#3A2027', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="musical-notes" size={25} color="#FA5265" />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 13 }}>
                  <Text numberOfLines={1} style={{ color: 'white', fontSize: 17, fontWeight: '700' }}>{playlist.name}</Text>
                  <Text style={{ color: '#A1A1A6', fontSize: 14, marginTop: 4 }}>{playlist.trackCount} {playlist.trackCount === 1 ? 'song' : 'songs'}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDelete(playlist)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${playlist.name}`} style={{ width: 46, height: 52, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="trash-outline" size={21} color="#FA5265" />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      <Modal
        visible={createVisible}
        transparent
        animationType="slide"
        onRequestClose={closeCreate}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' }}
        >
          <View style={{ backgroundColor: '#1C1C1E', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 24, paddingTop: 13, paddingBottom: 30 }}>
            <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: '#636366', marginBottom: 18 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <TouchableOpacity onPress={closeCreate} disabled={busy}>
                <Text style={{ color: '#FA5265', fontSize: 17 }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={{ color: 'white', fontSize: 18, fontWeight: '700' }}>New Playlist</Text>
              <TouchableOpacity onPress={() => void create()} disabled={busy || !name.trim()} style={{ minWidth: 48, alignItems: 'flex-end' }}>
                {busy ? <ActivityIndicator color="#FA5265" /> : <Text style={{ color: name.trim() ? '#FA5265' : '#6E6E73', fontSize: 17, fontWeight: '700' }}>Create</Text>}
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 22 }}>
              <TouchableOpacity
                onPress={() => void chooseCover()}
                accessibilityLabel="Choose playlist cover"
                style={{ width: 122, height: 122, borderRadius: 15, backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
              >
                {cover ? (
                  <Image source={{ uri: cover.uri }} style={{ width: '100%', height: '100%' }} />
                ) : (
                  <>
                    <Ionicons name="musical-note" size={35} color="#FA5265" />
                    <Text style={{ color: '#D1D1D6', fontSize: 12, fontWeight: '600', marginTop: 7 }}>Add Cover</Text>
                  </>
                )}
                <View style={{ position: 'absolute', right: 7, bottom: 7, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="camera" size={15} color="white" />
                </View>
              </TouchableOpacity>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Playlist Name"
                placeholderTextColor="#77777D"
                maxLength={80}
                returnKeyType="done"
                onSubmitEditing={() => void create()}
                autoFocus
                style={{ flex: 1, minHeight: 54, marginLeft: 18, paddingHorizontal: 2, color: 'white', fontSize: 19, fontWeight: '600', borderBottomWidth: 1, borderBottomColor: '#48484A' }}
              />
            </View>

            <Text style={{ color: '#8E8E93', fontSize: 13, lineHeight: 18, textAlign: 'center' }}>
              The playlist and its cover are saved on this phone.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};
