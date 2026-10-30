import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaybackActions } from '../contexts/PlaybackContext';
import { AUDIO_MIXES, GENRE_MIXES, AudiusCatalogService, type AudiusMixDefinition, type AudiusMixId, type GenreMixId } from '../services/AudiusCatalogService';
import type { Track } from '../types';

type HomeNavigation = BottomTabNavigationProp<{
  Home: undefined;
  Radio: undefined;
  Library: { screen: 'DeveloperProfile' } | undefined;
  Search: undefined;
}, 'Home'>;

type RadioStation = {
  stationuuid: string;
  name: string;
  url?: string;
  url_resolved?: string;
  favicon?: string;
  country?: string;
  language?: string;
  lastcheckok?: number | boolean;
};

type MixTracks = Record<AudiusMixId, Track[]>;
type QuranSurah = {
  number: number;
  englishName: string;
  arabicName: string;
};
type QuranReciter = {
  edition: string;
  name: string;
  bitrate: number;
  surahAudioUrl?: (surahNumber: number) => string;
  arabicName?: string;
  artwork?: string;
};
type GenreMixTracks = Record<GenreMixId, Track[]>;

const emptyGenreMixTracks = (): GenreMixTracks => ({
  lofi: [],
  afrohouse: [],
  'trip-hop': [],
  chillpop: [],
});

const GENRE_MIX_QUEUE_SIZE = 18;
const QURAN_SURAHS_URL = 'https://api.alquran.cloud/v1/surah';
const QURAN_AUDIO_URL = 'https://cdn.islamic.network/quran/audio-surah';
const QURAN_RECITER_PHOTO_URL = 'https://juzzquran.com/images/reciters';
const QURAN_COM_RECITER_PHOTO_URL = 'https://static.qurancdn.com/images/reciters';
const QURAN_RECITER_CATALOG_URL = 'https://cdn.islamic.network/quran/info/by-surah/info.json';
const QURAN_EDITIONS_URL = 'https://api.alquran.cloud/v1/edition/format/audio';
const QURAN_COM_RECITER_PHOTO_MATCHES: readonly { aliases: readonly string[]; file: string }[] = [
  { aliases: ['mahermuaiqly', 'maheralmuaiqly'], file: '25/Maher-al-Muaiqly-profile.png' },
  { aliases: ['abdulbasit', 'abdulbaset'], file: '1/abdelbasset-profile.jpeg' },
  { aliases: ['abdurrahmaansudais', 'sudais'], file: '2/abdul-rahman-al-sudais-profile.jpeg' },
  { aliases: ['abubakrshatri', 'abubakrshaatree', 'shaatree'], file: '3/abu-bakr-al-shatri-pofile.jpeg' },
  { aliases: ['haniarrifai', 'hanirifai'], file: '4/hani-ar-rifai-profile.jpeg' },
  { aliases: ['husary', 'hussary'], file: '5/mahmoud-khalil-al-hussary-profile.png' },
  { aliases: ['saoodshuraym', 'saudshuraim'], file: '8/saoud-shuraim-profile.jpeg' },
  { aliases: ['khalifaaltunaiji'], file: '11/khalifa-al-tunaiji-profile.jpeg' },
  { aliases: ['misharyalafasy', 'misharialafasy', 'alafasy'], file: '6/mishary-rashid-alafasy-profile.jpeg' },
  { aliases: ['minshawi', 'minshawy'], file: '7/mohamed-siddiq-el-minshawi-profile.jpeg' },
];
const QURAN_RECITER_PHOTO_MATCHES: readonly { aliases: readonly string[]; file: string }[] = [
  { aliases: ['abdullahjuhany', 'abdullahaljuhany', 'juhani'], file: 'abdullah-al-juhany.webp' },
  { aliases: ['abdullahmatroud', 'matrood'], file: 'abdullah-matroud.webp' },
  { aliases: ['ahmedneana', 'neana'], file: 'ahmed-neana.webp' },
  { aliases: ['akramalaqami', 'alaqmi'], file: 'akram-al-alaqimi.webp' },
  { aliases: ['alihajjajsuesy', 'alihajjajsouissi', 'souissi'], file: 'ali-hajjaj-al-suesy.webp' },
  { aliases: ['alijaber'], file: 'ali-jaber.webp' },
  { aliases: ['aymansowaid', 'aymanswed', 'swaid'], file: 'ayman-sowaid.webp' },
  { aliases: ['faresabbad'], file: 'fares-abbad.webp' },
  { aliases: ['saadghamdi', 'alghamdi'], file: 'saad-al-ghamdi.webp' },
  { aliases: ['husary', 'hussary'], file: 'al-husary.webp' },
  { aliases: ['karimmansouri'], file: 'karim-mansouri.webp' },
  { aliases: ['khaledalqahtani', 'khaalidalqahtaanee'], file: 'khaalid-al-qahtaanee.webp' },
  { aliases: ['minshawi', 'minshawy'], file: 'al-minshawi.webp' },
  { aliases: ['mohamedtablawi', 'mohammadtablaway'], file: 'mohammad-al-tablaway.webp' },
  { aliases: ['muhammadabdulkareem'], file: 'muhammad-abdulkareem.webp' },
  { aliases: ['muhsinalqasim', 'abdulmuhsinalqasim'], file: 'muhsin-al-qasim.webp' },
  { aliases: ['mustafaismail'], file: 'mustafa-ismail.webp' },
  { aliases: ['nabilrifai'], file: 'nabil-rifai.webp' },
  { aliases: ['nasserqatami', 'nasseralqatami'], file: 'nasser-al-qatami.webp' },
  { aliases: ['parhizgar'], file: 'parhizgar.webp' },
  { aliases: ['sahlyasin'], file: 'sahl-yassin.webp' },
  { aliases: ['salaahbukhatir', 'salahbukhatir'], file: 'salaah-bukhatir.webp' },
  { aliases: ['salahbudair', 'salahalbudair'], file: 'salah-al-budair.webp' },
  { aliases: ['yassersalamah'], file: 'yaser-salamah.webp' },
  { aliases: ['yasserdossari', 'yasseraldossari', 'yasseraddossari'], file: 'yasser-ad-dussary.webp' },
  { aliases: ['azizalili'], file: 'aziz-alili.webp' },
  { aliases: ['khalifaaltunaiji'], file: 'khalefa-al-tunaiji.webp' },
  { aliases: ['mahmoudalialbanna'], file: 'mahmoud-ali-al-banna.webp' },
  { aliases: ['ibrahimaldossari', 'ibrahimaldosary'], file: 'ibrahim-al-dosary.webp' },
  { aliases: ['yassenaljazairi'], file: 'yassin-al-jazaery.webp' },
  { aliases: ['ibrahimakhdar', 'ibrahimalakhdar'], file: 'ibrahim-al-akhdar.webp' },
  { aliases: ['misharyalafasy', 'misharialafasy', 'alafasy'], file: 'mishary-alafasy.webp' },
  { aliases: ['abdurrahmaansudais', 'sudais'], file: 'abdurrahmaan-as-sudais.webp' },
  { aliases: ['abubakrshatri', 'abubakrshaatree', 'shaatree'], file: 'abu-bakr-ash-shatri.webp' },
  { aliases: ['abdullahbasfar'], file: 'abdullah-basfar.webp' },
  { aliases: ['ahmedajamy', 'ahmedalajmi'], file: 'ahmed-al-ajamy.webp' },
  { aliases: ['muhammadjibreel'], file: 'muhammad-jibreel.webp' },
  { aliases: ['muhammadayyoub', 'muhammadayyub'], file: 'muhammad-ayyoub.webp' },
  { aliases: ['saoodshuraym', 'saudshuraim'], file: 'saood-ash-shuraym.webp' },
  { aliases: ['mahermuaiqly', 'maheralmuaiqly'], file: 'maher-al-muaiqly.webp' },
  { aliases: ['alhuthaify', 'hudhaify'], file: 'ali-al-hudhaify.webp' },
  { aliases: ['mansoursalimi'], file: 'mansour-al-salimi.webp' },
];

const getQuranReciterArtwork = (edition: string, name: string, arabicName?: string) => {
  if (edition === 'ar.abdulazizazzahrani') {
    return 'https://storage.googleapis.com/way2quran_storage/imgs/abdulaziz-al-zahrani.jpg';
  }
  const normalized = `${edition} ${name} ${arabicName || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const quranComPortrait = QURAN_COM_RECITER_PHOTO_MATCHES.find(({ aliases }) => aliases.some((alias) => normalized.includes(alias)));
  if (quranComPortrait) return `${QURAN_COM_RECITER_PHOTO_URL}/${quranComPortrait.file}?v=1`;
  const portrait = QURAN_RECITER_PHOTO_MATCHES.find(({ aliases }) => aliases.some((alias) => normalized.includes(alias)));
  return portrait ? `${QURAN_RECITER_PHOTO_URL}/${portrait.file}` : undefined;
};

const MAHER_AL_MUAIQLY_RECITER: QuranReciter = {
  edition: 'ar.mahermuaiqly',
  name: 'Maher Al-Muaiqly',
  bitrate: 128,
  surahAudioUrl: (surahNumber) => `https://cdn.mp3quran.net/audio/maher-muaiqly/r1/${String(surahNumber).padStart(3, '0')}.mp3`,
  artwork: getQuranReciterArtwork('ar.mahermuaiqly', 'Maher Al-Muaiqly'),
};
const QURAN_RECITERS = [
  { edition: 'ar.alafasy', name: 'Mishary Alafasy', bitrate: 128, artwork: getQuranReciterArtwork('ar.alafasy', 'Mishary Alafasy') },
  MAHER_AL_MUAIQLY_RECITER,
  { edition: 'ar.abdulbasitmujawwad', name: 'Abdul Basit (Mujawwad)', bitrate: 128, artwork: getQuranReciterArtwork('ar.abdulbasitmujawwad', 'Abdul Basit (Mujawwad)') },
  { edition: 'ar.muhammadsiddiqalminshawimujawwad', name: 'Mohamed al-Minshawi', bitrate: 128, artwork: getQuranReciterArtwork('ar.muhammadsiddiqalminshawimujawwad', 'Mohamed al-Minshawi') },
  { edition: 'ar.sudaisshuraymnaeemsultan', name: 'Al-Sudais & Al-Shuraim', bitrate: 128, artwork: getQuranReciterArtwork('ar.sudaisshuraymnaeemsultan', 'Al-Sudais & Al-Shuraim') },
] satisfies readonly QuranReciter[];

const QURAN_RECITER_NAME_OVERRIDES: Record<string, string> = {
  'ar.abdulmuhsinalqasim': 'Abdul Muhsin al-Qasim',
  'ar.abdurrazaqbinabtanaldulaimi': 'Abdurrazaq bin Abtan al-Dulaimi',
  'ar.ahmadalnufais': 'Ahmad al-Nufais',
  'ar.bandarbalila': 'Bandar Balila',
  'ar.eidhassanabuaachra': 'Eid Hassan Abu Aachra',
  'ar.jaberabdulhameed': 'Jaber Abdulhameed',
  'ar.karimmansouri': 'Karim Mansouri',
};

type QuranCatalogNode = {
  type?: unknown;
  name?: unknown;
  contents?: unknown;
};

const loadAvailableQuranReciters = async (): Promise<QuranReciter[]> => {
  const [catalogResponse, editionsResponse] = await Promise.all([
    fetch(QURAN_RECITER_CATALOG_URL, { headers: { Accept: 'application/json' } }),
    fetch(QURAN_EDITIONS_URL, { headers: { Accept: 'application/json' } }),
  ]);
  if (!catalogResponse.ok || !editionsResponse.ok) {
    throw new Error('Could not load the reciter catalog.');
  }

  const [catalogPayload, editionsPayload] = await Promise.all([
    catalogResponse.json() as Promise<unknown>,
    editionsResponse.json() as Promise<unknown>,
  ]);
  if (!Array.isArray(catalogPayload)) throw new Error('The reciter catalog was invalid.');
  const catalogRoot = (catalogPayload as QuranCatalogNode[]).find((node) => (
    node.type === 'directory' && typeof node.name === 'string' && node.name.endsWith('/quran/audio-surah')
  ));
  if (!catalogRoot || !Array.isArray(catalogRoot.contents)) throw new Error('The reciter catalog was invalid.');

  const editionsRecord = editionsPayload as { data?: unknown };
  const editionMetadata = new Map<string, { name: string; arabicName?: string }>();
  if (Array.isArray(editionsRecord.data)) {
    for (const entry of editionsRecord.data) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (record.language !== 'ar' || typeof record.identifier !== 'string') continue;
      const name = typeof record.englishName === 'string' ? record.englishName.trim() : '';
      const arabicName = typeof record.name === 'string' ? record.name.trim() : '';
      if (name) editionMetadata.set(record.identifier, { name, arabicName: arabicName || undefined });
    }
  }

  const availableEditions = new Map<string, number>();
  for (const bitrateNode of catalogRoot.contents as QuranCatalogNode[]) {
    if (typeof bitrateNode.name !== 'string' || !/^\d+$/.test(bitrateNode.name) || !Array.isArray(bitrateNode.contents)) continue;
    const bitrate = Number(bitrateNode.name);
    for (const editionNode of bitrateNode.contents as QuranCatalogNode[]) {
      if (editionNode.type !== 'directory' || typeof editionNode.name !== 'string' || !editionNode.name.startsWith('ar.') || !Array.isArray(editionNode.contents)) continue;
      const surahFiles = new Set((editionNode.contents as QuranCatalogNode[])
        .filter((file) => file.type === 'file' && typeof file.name === 'string' && /^\d+\.mp3$/.test(file.name))
        .map((file) => Number((file.name as string).slice(0, -4))));
      if (surahFiles.size < 114 || Array.from({ length: 114 }, (_, index) => index + 1).some((number) => !surahFiles.has(number))) continue;
      const previousBitrate = availableEditions.get(editionNode.name);
      if (!previousBitrate || bitrate > previousBitrate) availableEditions.set(editionNode.name, bitrate);
    }
  }

  const catalogReciters = Array.from(availableEditions, ([edition, bitrate]) => {
    const metadata = editionMetadata.get(edition);
    return {
      edition,
      name: metadata?.name || QURAN_RECITER_NAME_OVERRIDES[edition] || edition.slice(3),
      arabicName: metadata?.arabicName,
      bitrate,
      artwork: getQuranReciterArtwork(edition, metadata?.name || QURAN_RECITER_NAME_OVERRIDES[edition] || edition.slice(3), metadata?.arabicName),
    };
  });
  const reciters = catalogReciters.some((reciter) => reciter.edition === 'ar.mahermuaiqly')
    ? catalogReciters
    : [...catalogReciters, MAHER_AL_MUAIQLY_RECITER];
  return reciters.sort((first, second) => first.name.localeCompare(second.name));
};

const RADIO_DIRECTORY_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];

const PAYPAL_DONATION_URL = 'https://paypal.me/kotmanii';
const PAYPAL_ME_SETUP_URL = 'https://www.paypal.com/paypalme/';

const emptyMixTracks = (): MixTracks => ({
  arabic: [],
  morocco: [],
  english: [],
  'mix-2026': [],
  'golden-2017': [],
});

const getStationStreamUrl = (station: RadioStation) => {
  const url = station.url_resolved?.trim() || station.url?.trim() || '';
  return url.startsWith('https://') ? url : '';
};

const loadHomeStations = async (): Promise<RadioStation[]> => {
  let lastError: unknown;

  for (const mirror of RADIO_DIRECTORY_MIRRORS) {
    try {
      const response = await fetch(`${mirror}/json/stations/topclick/24?hidebroken=true&is_https=true`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Musiqapp/1.0' },
      });
      if (!response.ok) {
        lastError = new Error(`Radio directory returned ${response.status}.`);
        continue;
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error('Radio directory returned an invalid station list.');

      const seen = new Set<string>();
      return (payload as RadioStation[]).filter((station) => {
        if (!station.stationuuid || !station.name?.trim() || !getStationStreamUrl(station)) return false;
        if (station.lastcheckok === 0 || station.lastcheckok === false || seen.has(station.stationuuid)) return false;
        seen.add(station.stationuuid);
        return true;
      }).slice(0, 16);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Radio directory is unavailable.');
};

const reportStationClick = (stationId: string) => {
  void (async () => {
    for (const mirror of RADIO_DIRECTORY_MIRRORS) {
      try {
        const response = await fetch(`${mirror}/json/url/${encodeURIComponent(stationId)}`, {
          headers: { Accept: 'application/json', 'User-Agent': 'Musiqapp/1.0' },
        });
        if (response.ok) return;
      } catch {
        // Station click reporting is best effort and must not block playback.
      }
    }
  })();
};

const toStationTrack = (station: RadioStation): Track => ({
  id: `radio:${station.stationuuid}`,
  provider: 'radio',
  providerId: station.stationuuid,
  title: station.name.trim(),
  artist: station.country?.trim() || station.language?.split(',')[0]?.trim() || 'Live Radio',
  album: 'Live Radio',
  duration: 'LIVE',
  durationSeconds: 0,
  artwork: station.favicon?.startsWith('https://') ? station.favicon : '',
  streamUrl: getStationStreamUrl(station),
  downloadUrl: null,
  downloadAllowed: false,
});

const PressableCard = memo(({
  children,
  onPress,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress: () => void;
  style: StyleProp<ViewStyle>;
  accessibilityLabel: string;
}) => {
  const [scale] = useState(() => new Animated.Value(1));

  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.975, damping: 18, stiffness: 300, mass: 0.65, useNativeDriver: true }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, damping: 16, stiffness: 260, mass: 0.65, useNativeDriver: true }).start()}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
});
PressableCard.displayName = 'PressableCard';

const NonStopMixCard = memo(({
  mix,
  tracks,
  loading,
  width,
  onPress,
}: {
  mix: AudiusMixDefinition;
  tracks: Track[];
  loading: boolean;
  width: number;
  onPress: () => void;
}) => {
  const [failedArtwork, setFailedArtwork] = useState('');
  const artwork = tracks[0]?.artwork;
  const artworkFailed = Boolean(artwork) && failedArtwork === artwork;

  return (
    <PressableCard
      style={{ width, marginRight: 13 }}
      onPress={onPress}
      accessibilityLabel={tracks.length ? `Play the ${mix.title} non-stop mix` : `Refresh the ${mix.title} mix`}
    >
      <View style={{ width, height: width, borderRadius: 20, overflow: 'hidden', backgroundColor: '#161619', borderWidth: 1, borderColor: '#28282D', justifyContent: 'center', alignItems: 'center' }}>
        {artwork && !artworkFailed ? (
          <Image source={{ uri: artwork }} onError={() => setFailedArtwork(artwork ?? '')} resizeMode="cover" style={{ position: 'absolute', width: '100%', height: '100%' }} />
        ) : (
          <LinearGradient colors={['#282027', '#111114', '#09090A']} style={{ position: 'absolute', width: '100%', height: '100%' }} />
        )}
        <LinearGradient
          colors={['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.54)', 'rgba(0,0,0,0.82)']}
          locations={[0, 0.52, 1]}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
        <View style={{ position: 'absolute', top: 13, flexDirection: 'row', alignItems: 'center', gap: 5, opacity: 0.92 }}>
          <Ionicons name="infinite" size={15} color="white" />
          <Text style={{ color: 'white', fontSize: 10, fontWeight: '800', letterSpacing: 1.15 }}>NON-STOP</Text>
        </View>
        <Text
          numberOfLines={2}
          style={{ color: 'white', fontSize: mix.id === 'golden-2017' ? 23 : 25, lineHeight: 29, fontWeight: '800', letterSpacing: -0.55, textAlign: 'center', paddingHorizontal: 13, textShadowColor: mix.glow, textShadowRadius: 17, textShadowOffset: { width: 0, height: 0 } }}
        >
          {mix.title}
        </Text>
        <View style={{ position: 'absolute', bottom: 12, right: 12, width: 31, height: 31, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.58)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
          {loading && tracks.length === 0 ? <ActivityIndicator size="small" color="white" /> : (
            <Ionicons name={tracks.length ? 'play' : 'refresh'} size={15} color="white" />
          )}
        </View>
      </View>
      <Text numberOfLines={1} style={{ color: 'white', fontSize: 15, fontWeight: '700', marginTop: 10 }}>{mix.title}</Text>
      <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 12, fontWeight: '500', marginTop: 3 }}>
        {tracks.length ? `Audius · ${tracks.length} tracks` : loading ? 'Finding your mix…' : 'Tap to try again'}
      </Text>
    </PressableCard>
  );
});
NonStopMixCard.displayName = 'NonStopMixCard';

const GenreMixCard = memo(({
  genreMix,
  tracks,
  loading,
  width,
  onPress,
}: {
  genreMix: (typeof GENRE_MIXES)[number];
  tracks: Track[];
  loading: boolean;
  width: number;
  onPress: () => void;
}) => {
  const [failedArtwork, setFailedArtwork] = useState('');
  const artwork = tracks[0]?.artwork;
  const artworkFailed = Boolean(artwork) && failedArtwork === artwork;

  return (
    <PressableCard
      style={{ width, marginRight: 13 }}
      onPress={onPress}
      accessibilityLabel={tracks.length ? `Play the ${genreMix.title} mix` : `Refresh the ${genreMix.title} mix`}
    >
      <View style={{ width, height: width, borderRadius: 20, overflow: 'hidden', backgroundColor: '#161619', borderWidth: 1, borderColor: '#302735', justifyContent: 'center', alignItems: 'center' }}>
        {artwork && !artworkFailed ? (
          <Image source={{ uri: artwork }} onError={() => setFailedArtwork(artwork ?? '')} resizeMode="cover" style={{ position: 'absolute', width: '100%', height: '100%' }} />
        ) : (
          <LinearGradient colors={['#392A3C', '#19141C', '#09090A']} style={{ position: 'absolute', width: '100%', height: '100%' }} />
        )}
        <LinearGradient
          colors={['rgba(0,0,0,0.22)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.84)']}
          locations={[0, 0.52, 1]}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
        <View style={{ position: 'absolute', top: 13, flexDirection: 'row', alignItems: 'center', gap: 5, opacity: 0.94 }}>
          <Ionicons name="sparkles" size={14} color="#E4C5F0" />
          <Text style={{ color: 'white', fontSize: 10, fontWeight: '800', letterSpacing: 1.15 }}>GENRE MIX</Text>
        </View>
        <Text
          numberOfLines={2}
          style={{ color: 'white', fontSize: 25, lineHeight: 29, fontWeight: '800', letterSpacing: -0.55, textAlign: 'center', paddingHorizontal: 13, textShadowColor: '#D4B2E4', textShadowRadius: 17, textShadowOffset: { width: 0, height: 0 } }}
        >
          {genreMix.title}
        </Text>
        <View style={{ position: 'absolute', bottom: 12, right: 12, width: 31, height: 31, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.58)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
          {loading && tracks.length === 0 ? <ActivityIndicator size="small" color="white" /> : (
            <Ionicons name={tracks.length ? 'play' : 'refresh'} size={15} color="white" />
          )}
        </View>
      </View>
      <Text numberOfLines={1} style={{ color: 'white', fontSize: 15, fontWeight: '700', marginTop: 10 }}>{genreMix.title}</Text>
      <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 12, fontWeight: '500', marginTop: 3 }}>
        {tracks.length ? `Audius · ${tracks.length} tracks` : loading ? `Finding ${genreMix.title} tracks…` : 'Tap to try again'}
      </Text>
    </PressableCard>
  );
});
GenreMixCard.displayName = 'GenreMixCard';

const QuranReciterCard = memo(({
  reciter,
  active,
  loading,
  unavailable,
  width,
  onPress,
}: {
  reciter: QuranReciter;
  active: boolean;
  loading: boolean;
  unavailable: boolean;
  width: number;
  onPress: () => void;
}) => (
  <PressableCard
    style={{ width, marginRight: 13 }}
    onPress={onPress}
  accessibilityLabel={`Browse surahs recited by ${reciter.name}`}
  >
    <View style={{ width, height: width, borderRadius: 20, overflow: 'hidden', backgroundColor: '#151518', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', justifyContent: 'center', alignItems: 'center' }}>
      {reciter.artwork ? (
        <ExpoImage
          source={{ uri: reciter.artwork }}
          contentFit="cover"
          transition={180}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
      ) : (
        <LinearGradient colors={['#343438', '#1D1D20', '#111113']} style={{ position: 'absolute', width: '100%', height: '100%' }} />
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0.06)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.76)']}
        locations={[0, 0.48, 1]}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
      <View style={{ position: 'absolute', top: 13, flexDirection: 'row', alignItems: 'center', gap: 5, opacity: 0.94 }}>
        <Ionicons name="book-outline" size={15} color="#E4D6A8" />
        <Text style={{ color: '#F0E5C3', fontSize: 10, fontWeight: '800', letterSpacing: 1.15 }}>QURAN</Text>
      </View>
      {!reciter.artwork ? <Text style={{ color: 'rgba(255,255,255,0.62)', fontSize: 58, fontWeight: '800' }}>{reciter.name.slice(0, 1).toUpperCase()}</Text> : null}
      <Text numberOfLines={2} style={{ position: 'absolute', bottom: 17, color: 'white', fontSize: 16, lineHeight: 20, fontWeight: '800', letterSpacing: -0.25, textAlign: 'center', paddingHorizontal: 12 }}>
        {reciter.name}
      </Text>
      <View style={{ position: 'absolute', bottom: 12, right: 12, width: 31, height: 31, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.58)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
        {loading ? <ActivityIndicator size="small" color="#F0E5C3" /> : (
          <Ionicons name={unavailable ? 'refresh' : active ? 'volume-high' : 'play'} size={15} color="white" />
        )}
      </View>
    </View>
    <Text numberOfLines={1} style={{ color: 'white', fontSize: 15, fontWeight: '700', marginTop: 10 }}>{reciter.name}</Text>
    <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 12, fontWeight: '500', marginTop: 3 }}>
      {unavailable ? 'Tap to retry' : active ? 'Now playing · Quran' : 'Quran · 114 surahs'}
    </Text>
  </PressableCard>
));
QuranReciterCard.displayName = 'QuranReciterCard';

const AllQuranRecitersCard = memo(({ width, count, onPress }: { width: number; count: number; onPress: () => void }) => (
  <PressableCard
    style={{ width, marginRight: 13 }}
    onPress={onPress}
    accessibilityLabel="See all available Quran reciters"
  >
    <View style={{ width, height: width, borderRadius: 20, overflow: 'hidden', backgroundColor: '#111713', borderWidth: 1, borderColor: '#344238', justifyContent: 'center', alignItems: 'center' }}>
      <LinearGradient colors={['#263C2E', '#121A15', '#090B09']} style={{ position: 'absolute', width: '100%', height: '100%' }} />
      <LinearGradient
        colors={['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.38)', 'rgba(0,0,0,0.8)']}
        locations={[0, 0.52, 1]}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
      <View style={{ position: 'absolute', top: 13, flexDirection: 'row', alignItems: 'center', gap: 5, opacity: 0.94 }}>
        <Ionicons name="book-outline" size={15} color="#E4D6A8" />
        <Text style={{ color: '#F0E5C3', fontSize: 10, fontWeight: '800', letterSpacing: 1.15 }}>QURAN</Text>
      </View>
      <View style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 1, borderColor: 'rgba(232,216,166,0.32)', alignItems: 'center', justifyContent: 'center', marginBottom: 10, backgroundColor: 'rgba(230,215,170,0.08)' }}>
        <Ionicons name="ellipsis-horizontal" size={31} color="#E4D6A8" />
      </View>
      <Text style={{ color: 'white', fontSize: 16, lineHeight: 20, fontWeight: '800', letterSpacing: -0.25, textAlign: 'center', paddingHorizontal: 12 }}>
        All reciters
      </Text>
    </View>
    <Text numberOfLines={1} style={{ color: 'white', fontSize: 15, fontWeight: '700', marginTop: 10 }}>See all reciters</Text>
    <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 12, fontWeight: '500', marginTop: 3 }}>
      {count > 0 ? `${count} available` : 'Browse all Quran reciters'}
    </Text>
  </PressableCard>
));
AllQuranRecitersCard.displayName = 'AllQuranRecitersCard';

const LiveRadioCard = memo(({
  station,
  active,
  width,
  onPress,
}: {
  station: RadioStation;
  active: boolean;
  width: number;
  onPress: () => void;
}) => {
  const [failedArtwork, setFailedArtwork] = useState('');
  const artworkFailed = !station.favicon?.startsWith('https://') || failedArtwork === station.favicon;

  return (
    <PressableCard
      style={{ width, marginRight: 13 }}
      onPress={onPress}
      accessibilityLabel={`${active ? 'Tune in to' : 'Play'} ${station.name}, live radio`}
    >
      <View style={{ width, height: width, borderRadius: 20, overflow: 'hidden', backgroundColor: '#18181B', alignItems: 'center', justifyContent: 'center', borderWidth: active ? 1.5 : 1, borderColor: active ? '#FA5265' : '#27272A' }}>
        {!artworkFailed && station.favicon ? (
          <Image source={{ uri: station.favicon }} onError={() => setFailedArtwork(station.favicon ?? '')} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        ) : (
          <LinearGradient colors={['#35151D', '#17171A']} style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="radio" size={42} color="#FA5265" />
          </LinearGradient>
        )}
        <View style={{ position: 'absolute', left: 10, top: 10, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.68)', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#FA5265' }} />
          <Text style={{ color: 'white', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }}>LIVE</Text>
        </View>
        <View style={{ position: 'absolute', right: 11, bottom: 11, width: 32, height: 32, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={active ? 'volume-high' : 'play'} size={15} color="white" />
        </View>
      </View>
      <Text numberOfLines={1} style={{ color: 'white', fontSize: 15, fontWeight: '700', marginTop: 10 }}>{station.name.trim()}</Text>
      <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 12, fontWeight: '500', marginTop: 3 }}>
        {station.country?.trim() || station.language?.split(',')[0]?.trim() || 'Live Radio'}
      </Text>
    </PressableCard>
  );
});
LiveRadioCard.displayName = 'LiveRadioCard';

export const HomeScreen = () => {
  const navigation = useNavigation<HomeNavigation>();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { activeTrack, playTrack, togglePlayback } = usePlaybackActions();
  const [mixTracks, setMixTracks] = useState<MixTracks>(emptyMixTracks);
  const [quranSurahs, setQuranSurahs] = useState<QuranSurah[]>([]);
  const [quranLoading, setQuranLoading] = useState(true);
  const [quranUnavailable, setQuranUnavailable] = useState(false);
  const [quranRetryKey, setQuranRetryKey] = useState(0);
  const [availableQuranReciters, setAvailableQuranReciters] = useState<QuranReciter[]>([]);
  const [allRecitersVisible, setAllRecitersVisible] = useState(false);
  const [allRecitersLoading, setAllRecitersLoading] = useState(false);
  const [allRecitersError, setAllRecitersError] = useState('');
  const [reciterSearch, setReciterSearch] = useState('');
  const [selectedQuranReciter, setSelectedQuranReciter] = useState<QuranReciter | null>(null);
  const [returnToReciterList, setReturnToReciterList] = useState(false);
  const [genreRetryKey, setGenreRetryKey] = useState(0);
  const [genreTracks, setGenreTracks] = useState<GenreMixTracks>(emptyGenreMixTracks);
  const [genreLoading, setGenreLoading] = useState(true);
  const [genreUnavailable, setGenreUnavailable] = useState(false);
  const genreRequestId = useRef(0);
  const quranReciterCatalogRequest = useRef(false);
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [mixLoading, setMixLoading] = useState(true);
  const [radioLoading, setRadioLoading] = useState(true);
  const [mixUnavailable, setMixUnavailable] = useState(false);
  const [radioUnavailable, setRadioUnavailable] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const topInsetCompensation = Math.max(0, insets.top - 24);
  const homeScrollY = useMemo(() => new Animated.Value(0), []);
  const homeScrollHandler = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: homeScrollY } } }], { useNativeDriver: true }),
    [homeScrollY],
  );
  const topFadeOpacity = homeScrollY.interpolate({
    inputRange: [0, 10, 26],
    outputRange: [0, 0.75, 1],
    extrapolate: 'clamp',
  });
  const [introOpacity] = useState(() => new Animated.Value(0));
  const [introY] = useState(() => new Animated.Value(12));
  const cardWidth = Math.min(174, Math.max(142, Math.floor((screenWidth - 64) / 2)));

  useEffect(() => {
    const intro = Animated.parallel([
      Animated.timing(introOpacity, { toValue: 1, duration: 460, useNativeDriver: true, isInteraction: false }),
      Animated.spring(introY, { toValue: 0, damping: 19, stiffness: 165, mass: 0.85, useNativeDriver: true, isInteraction: false }),
    ]);
    intro.start();
    return () => intro.stop();
  }, [introOpacity, introY]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      Promise.all(AUDIO_MIXES.map(async (mix) => {
        try {
          return { id: mix.id, tracks: await AudiusCatalogService.getMixTracks(mix.id) };
        } catch {
          return { id: mix.id, tracks: [] as Track[] };
        }
      })),
      loadHomeStations().catch(() => null),
    ]).then(([results, radioStations]) => {
      if (!mounted) return;
      const nextMixes = emptyMixTracks();
      results.forEach(({ id, tracks }) => { nextMixes[id] = tracks; });
      setMixTracks(nextMixes);
      setMixUnavailable(!results.some(({ tracks }) => tracks.length > 0));
      setStations(radioStations ?? []);
      setRadioUnavailable(!radioStations);
    }).finally(() => {
      if (mounted) {
        setMixLoading(false);
        setRadioLoading(false);
      }
    });

    return () => { mounted = false; };
  }, [refreshKey]);

  useEffect(() => {
    let mounted = true;

    void fetch(QURAN_SURAHS_URL, { headers: { Accept: 'application/json' } }).then(async (response) => {
      if (!response.ok) throw new Error(`Quran catalog returned ${response.status}.`);
      const payload = await response.json() as { data?: unknown };
      if (!Array.isArray(payload.data)) throw new Error('Quran catalog returned an invalid surah list.');

      const surahs = payload.data.flatMap((item: unknown): QuranSurah[] => {
        if (typeof item !== 'object' || item === null) return [];
        const record = item as Record<string, unknown>;
        if (typeof record.number !== 'number' || typeof record.englishName !== 'string') return [];
        return [{
          number: record.number,
          englishName: record.englishName,
          arabicName: typeof record.name === 'string' ? record.name : '',
        }];
      });
      if (surahs.length === 0) throw new Error('Quran catalog did not contain any surahs.');
      if (mounted) setQuranSurahs(surahs);
    }).catch(() => {
      if (mounted) setQuranUnavailable(true);
    }).finally(() => {
      if (mounted) setQuranLoading(false);
    });

    return () => { mounted = false; };
  }, [quranRetryKey]);

  useEffect(() => {
    const requestId = ++genreRequestId.current;

    void Promise.all(GENRE_MIXES.map(async (genreMix) => {
      try {
        return { genreMixId: genreMix.id, tracks: await AudiusCatalogService.getGenreMixTracks(genreMix.id, 0, GENRE_MIX_QUEUE_SIZE) };
      } catch {
        return { genreMixId: genreMix.id, tracks: [] as Track[] };
      }
    })).then((results) => {
      if (genreRequestId.current !== requestId) return;
      const nextGenreTracks = emptyGenreMixTracks();
      results.forEach(({ genreMixId, tracks }) => { nextGenreTracks[genreMixId] = tracks; });
      setGenreTracks(nextGenreTracks);
      setGenreUnavailable(!results.some(({ tracks }) => tracks.length > 0));
    }).finally(() => {
      if (genreRequestId.current === requestId) setGenreLoading(false);
    });

    return () => {
      if (genreRequestId.current === requestId) genreRequestId.current += 1;
    };
  }, [refreshKey, genreRetryKey]);

  const radioTracks = useMemo(() => stations.map(toStationTrack), [stations]);
  const retryQuranCatalog = useCallback(() => {
    setQuranLoading(true);
    setQuranUnavailable(false);
    setQuranRetryKey((current) => current + 1);
  }, []);

  const loadAllReciters = useCallback(async () => {
    if (quranReciterCatalogRequest.current) return;
    quranReciterCatalogRequest.current = true;
    setAllRecitersLoading(true);
    setAllRecitersError('');
    try {
      const reciters = await loadAvailableQuranReciters();
      if (reciters.length === 0) throw new Error('No complete Quran recitations were found.');
      setAvailableQuranReciters(reciters);
    } catch (error) {
      setAllRecitersError(error instanceof Error ? error.message : 'Could not load the reciter catalog.');
    } finally {
      quranReciterCatalogRequest.current = false;
      setAllRecitersLoading(false);
    }
  }, []);

  const openAllReciters = useCallback(() => {
    setSelectedQuranReciter(null);
    setReturnToReciterList(false);
    setAllRecitersVisible(true);
    setReciterSearch('');
    if (availableQuranReciters.length === 0) void loadAllReciters();
  }, [availableQuranReciters.length, loadAllReciters]);

  const openQuranReciter = useCallback((reciter: QuranReciter, fromReciterList = false) => {
    setSelectedQuranReciter(reciter);
    setReturnToReciterList(fromReciterList);
    setAllRecitersVisible(true);
  }, []);

  const closeQuranReciters = useCallback(() => {
    setAllRecitersVisible(false);
    setSelectedQuranReciter(null);
    setReturnToReciterList(false);
  }, []);

  const goBackFromQuranReciter = useCallback(() => {
    if (returnToReciterList) {
      setSelectedQuranReciter(null);
      setReturnToReciterList(false);
      return;
    }
    closeQuranReciters();
  }, [closeQuranReciters, returnToReciterList]);

  const filteredQuranReciters = useMemo(() => {
    const query = reciterSearch.trim().toLocaleLowerCase();
    if (!query) return availableQuranReciters;
    return availableQuranReciters.filter((reciter) => (
      `${reciter.name} ${reciter.arabicName ?? ''} ${reciter.edition}`.toLocaleLowerCase().includes(query)
    ));
  }, [availableQuranReciters, reciterSearch]);

  const refreshDiscovery = useCallback(() => {
    setMixLoading(true);
    setRadioLoading(true);
    setGenreLoading(true);
    setMixUnavailable(false);
    setRadioUnavailable(false);
    setGenreUnavailable(false);
    retryQuranCatalog();
    setRefreshKey((current) => current + 1);
  }, [retryQuranCatalog]);

  const refreshGenres = useCallback(() => {
    setGenreLoading(true);
    setGenreUnavailable(false);
    setGenreRetryKey((current) => current + 1);
  }, []);

  const playMix = useCallback((mixId: AudiusMixId) => {
    const queue = mixTracks[mixId];
    if (queue.length > 0) playTrack(queue[0], queue);
    else refreshDiscovery();
  }, [mixTracks, playTrack, refreshDiscovery]);

  const playQuranSurah = useCallback((reciter: QuranReciter, startingSurahNumber = 1) => {
    if (quranLoading) return;
    if (quranUnavailable || quranSurahs.length === 0) {
      retryQuranCatalog();
      return;
    }

    const queue = quranSurahs.map((surah): Track => ({
      id: `quran:${reciter.edition}:${surah.number}`,
      provider: 'quran',
      providerId: reciter.edition,
      title: `${surah.number}. ${surah.englishName}`,
      artist: reciter.name,
      album: 'Quran Recitation',
      duration: '—',
      durationSeconds: 0,
      artwork: reciter.artwork || '',
      streamUrl: reciter.surahAudioUrl?.(surah.number)
        || `${QURAN_AUDIO_URL}/${reciter.bitrate}/${reciter.edition}/${surah.number}.mp3`,
      downloadUrl: null,
      downloadAllowed: false,
    }));
    const selectedTrack = queue.find((track) => track.id === `quran:${reciter.edition}:${startingSurahNumber}`) ?? queue[0];
    if (!selectedTrack) return;
    if (activeTrack?.id === selectedTrack.id) togglePlayback();
    else playTrack(selectedTrack, queue);
  }, [activeTrack?.id, playTrack, quranLoading, quranSurahs, quranUnavailable, retryQuranCatalog, togglePlayback]);

  const playGenreMix = useCallback((genreMixId: GenreMixId) => {
    const queue = genreTracks[genreMixId];
    const firstTrack = queue[0];
    if (!firstTrack) {
      setGenreLoading(true);
      setGenreUnavailable(false);
      setGenreRetryKey((current) => current + 1);
      return;
    }
    if (activeTrack?.id === firstTrack.id) togglePlayback();
    else playTrack(firstTrack, queue);
  }, [activeTrack?.id, genreTracks, playTrack, togglePlayback]);

  const playStation = useCallback((station: RadioStation) => {
    const track = toStationTrack(station);
    if (activeTrack?.id === track.id) {
      togglePlayback();
      return;
    }

    playTrack(track, radioTracks.length > 0 ? radioTracks : [track]);
    reportStationClick(station.stationuuid);
  }, [activeTrack?.id, playTrack, radioTracks, togglePlayback]);

  const openDonationLink = useCallback(async () => {
    if (!PAYPAL_DONATION_URL) {
      Alert.alert(
        'Connect your PayPal account',
        'Create a PayPal.Me link for your account, then add that URL to PAYPAL_DONATION_URL in HomeScreen.tsx.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open PayPal.Me', onPress: () => void Linking.openURL(PAYPAL_ME_SETUP_URL).catch(() => undefined) },
        ],
      );
      return;
    }

    try {
      await Linking.openURL(PAYPAL_DONATION_URL);
    } catch {
      Alert.alert('Could not open PayPal', 'Please try again in a moment.');
    }
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <View style={{ flex: 1, marginTop: -topInsetCompensation }}>
        <Animated.ScrollView
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={mixLoading || radioLoading || quranLoading || genreLoading} onRefresh={refreshDiscovery} tintColor="#FA5265" colors={['#FA5265']} />}
          onScroll={homeScrollHandler}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12 + topInsetCompensation, paddingBottom: 190 }}
        >
          <Animated.View style={{ opacity: introOpacity, transform: [{ translateY: introY }] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
              <Text style={{ color: 'white', fontSize: 40, lineHeight: 47, fontWeight: '800', letterSpacing: -1 }}>Home</Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('Library', { screen: 'DeveloperProfile' })}
                activeOpacity={0.78}
                accessibilityRole="button"
                accessibilityLabel="Open Kamal’s profile"
                style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden' }}
              >
                <LinearGradient colors={['#514A68', '#262331']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="person" size={27} color="white" />
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: 'white', fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.45 }}>Non-Stop Music</Text>
                <Text style={{ color: '#8E8E93', fontSize: 12, fontWeight: '500', marginTop: 3 }}>Fresh independent mixes, ready to keep playing</Text>
              </View>
              {mixLoading ? <ActivityIndicator color="#FA5265" size="small" /> : (
                <TouchableOpacity onPress={refreshDiscovery} hitSlop={10} accessibilityRole="button" accessibilityLabel="Refresh Home music" style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#171719', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="refresh" size={17} color="#B7B7BC" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 7, paddingBottom: 2 }}>
              {AUDIO_MIXES.map((mix) => (
                <NonStopMixCard
                  key={mix.id}
                  mix={mix}
                  tracks={mixTracks[mix.id]}
                  loading={mixLoading}
                  width={cardWidth}
                  onPress={() => playMix(mix.id)}
                />
              ))}
            </ScrollView>

            {mixUnavailable && !mixLoading ? (
              <TouchableOpacity onPress={refreshDiscovery} activeOpacity={0.75} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 9, paddingVertical: 8 }}>
                <Ionicons name="cloud-offline-outline" size={16} color="#FA5265" />
                <Text style={{ color: '#A1A1A6', fontSize: 12, marginLeft: 7 }}>Couldn’t load mixes. Tap to retry.</Text>
              </TouchableOpacity>
            ) : null}

            <View style={{ marginTop: 37, marginBottom: 15 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 37, height: 37, borderRadius: 19, backgroundColor: '#1B261F', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                  <Ionicons name="book-outline" size={19} color="#E4D6A8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: 'white', fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.45 }}>Quran</Text>
                  <Text style={{ color: '#8E8E93', fontSize: 12, fontWeight: '500', marginTop: 2 }}>Surah recitations · Al Quran Cloud</Text>
                </View>
                {quranLoading ? <ActivityIndicator color="#E4D6A8" size="small" /> : null}
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 7, paddingBottom: 2 }}>
              {QURAN_RECITERS.map((reciter) => (
                <QuranReciterCard
                  key={reciter.edition}
                  reciter={reciter}
                  active={activeTrack?.provider === 'quran' && activeTrack.providerId === reciter.edition}
                  loading={quranLoading && quranSurahs.length === 0}
                  unavailable={quranUnavailable}
                  width={cardWidth}
                  onPress={() => openQuranReciter(reciter)}
                />
              ))}
              <AllQuranRecitersCard
                width={cardWidth}
                count={availableQuranReciters.length}
                onPress={openAllReciters}
              />
            </ScrollView>

            {quranUnavailable ? (
              <TouchableOpacity onPress={retryQuranCatalog} activeOpacity={0.75} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 9, paddingVertical: 8 }}>
                <Ionicons name="cloud-offline-outline" size={16} color="#E4D6A8" />
                <Text style={{ color: '#A1A1A6', fontSize: 12, marginLeft: 7 }}>Couldn’t load the Quran catalog. Tap to retry.</Text>
              </TouchableOpacity>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 37, marginBottom: 15 }}>
              <View style={{ width: 37, height: 37, borderRadius: 19, backgroundColor: '#211925', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                <Ionicons name="sparkles" size={19} color="#D4B2E4" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: 'white', fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.45 }}>Genres</Text>
                <Text style={{ color: '#8E8E93', fontSize: 12, fontWeight: '500', marginTop: 3 }}>Explore genre mixes and let them play</Text>
              </View>
              {genreLoading ? <ActivityIndicator color="#D4B2E4" size="small" /> : (
                <TouchableOpacity onPress={refreshGenres} hitSlop={10} accessibilityRole="button" accessibilityLabel="Refresh genre mixes" style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#171719', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="refresh" size={17} color="#B7B7BC" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 7, paddingBottom: 2 }}>
              {GENRE_MIXES.map((genreMix) => (
                <GenreMixCard
                  key={genreMix.id}
                  genreMix={genreMix}
                  tracks={genreTracks[genreMix.id]}
                  loading={genreLoading}
                  width={cardWidth}
                  onPress={() => playGenreMix(genreMix.id)}
                />
              ))}
            </ScrollView>

            {genreUnavailable && !genreLoading ? (
              <TouchableOpacity onPress={refreshGenres} activeOpacity={0.75} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 9, paddingVertical: 8 }}>
                <Ionicons name="cloud-offline-outline" size={16} color="#D4B2E4" />
                <Text style={{ color: '#A1A1A6', fontSize: 12, marginLeft: 7 }}>Couldn’t load genre mixes. Tap to retry.</Text>
              </TouchableOpacity>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 37, marginBottom: 15 }}>
              <Text style={{ flex: 1, color: 'white', fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.45 }}>Live Radio Stations</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Radio')} hitSlop={8} accessibilityRole="button" accessibilityLabel="See all radio stations" style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingLeft: 7 }}>
                <Text style={{ color: '#FA5265', fontSize: 13, fontWeight: '700' }}>See all</Text>
                <Ionicons name="chevron-forward" size={15} color="#FA5265" style={{ marginLeft: 2 }} />
              </TouchableOpacity>
            </View>

            {radioLoading && stations.length === 0 ? (
              <View style={{ height: cardWidth + 51, flexDirection: 'row', alignItems: 'flex-start', gap: 13 }}>
                {[0, 1].map((item) => (
                  <View key={item} style={{ width: cardWidth, height: cardWidth, borderRadius: 20, backgroundColor: '#141416', alignItems: 'center', justifyContent: 'center' }}>
                    {item === 0 ? <ActivityIndicator size="small" color="#FA5265" /> : <Ionicons name="radio-outline" size={25} color="#343438" />}
                  </View>
                ))}
              </View>
            ) : stations.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 7, paddingBottom: 2 }}>
                {stations.map((station) => (
                  <LiveRadioCard
                    key={station.stationuuid}
                    station={station}
                    active={activeTrack?.id === `radio:${station.stationuuid}`}
                    width={cardWidth}
                    onPress={() => playStation(station)}
                  />
                ))}
              </ScrollView>
            ) : (
              <TouchableOpacity onPress={refreshDiscovery} activeOpacity={0.75} style={{ minHeight: 125, borderRadius: 20, backgroundColor: '#121214', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 20 }}>
                <Ionicons name={radioUnavailable ? 'cloud-offline-outline' : 'radio-outline'} size={20} color="#FA5265" />
                <Text style={{ color: '#A1A1A6', fontSize: 13, fontWeight: '600' }}>{radioUnavailable ? 'Couldn’t load stations · tap to retry' : 'No stations available right now'}</Text>
              </TouchableOpacity>
            )}

            <PressableCard
              style={{ width: '100%', marginTop: 34 }}
              onPress={() => void openDonationLink()}
              accessibilityLabel="Support Music app with a PayPal donation"
            >
              <LinearGradient
                colors={['#123879', '#0757C8', '#087BBE']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ minHeight: 348, borderRadius: 27, paddingHorizontal: 23, paddingVertical: 22, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(128,190,255,0.32)' }}
              >
                <View style={{ position: 'absolute', width: 185, height: 185, borderRadius: 93, right: -66, top: 73, backgroundColor: 'rgba(103,196,255,0.13)' }} />
                <View style={{ position: 'absolute', width: 118, height: 118, borderRadius: 59, left: -48, bottom: 24, backgroundColor: 'rgba(2,24,69,0.18)' }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 17 }}>
                  <FontAwesome name="paypal" size={18} color="white" />
                  <Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 12, fontWeight: '800', letterSpacing: 1.1, marginLeft: 8 }}>MUSIC · SUPPORT</Text>
                </View>
                <Text style={{ color: 'white', fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.65 }}>
                  Help keep the{ '\n' }music going.
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 14, lineHeight: 20, fontWeight: '500', marginTop: 8 }}>
                  Enjoying Musiqapp? A voluntary donation helps support its development.
                </Text>
                <View style={{ flex: 1, minHeight: 115, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 130, height: 98, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-5deg' }] }}>
                    <FontAwesome name="paypal" size={61} color="white" />
                  </View>
                  <View style={{ position: 'absolute', right: '26%', bottom: 12, width: 42, height: 42, borderRadius: 21, backgroundColor: '#FA5265', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#1766B7' }}>
                    <Ionicons name="heart" size={20} color="white" />
                  </View>
                </View>
                <View style={{ minHeight: 51, borderRadius: 26, paddingHorizontal: 18, backgroundColor: 'white', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#123879', fontSize: 15, fontWeight: '800' }}>Donate with PayPal</Text>
                  <View style={{ width: 31, height: 31, borderRadius: 16, backgroundColor: '#E8F1FF', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="arrow-forward" size={17} color="#0757C8" />
                  </View>
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: '500', textAlign: 'center', marginTop: 10 }}>
                  Payment is completed securely on PayPal
                </Text>
              </LinearGradient>
            </PressableCard>

            <View style={{ height: 18 }} />
          </Animated.View>
        </Animated.ScrollView>

        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -24,
            left: 0,
            right: 0,
            height: 170,
            zIndex: 15,
            elevation: 15,
            opacity: topFadeOpacity,
          }}
        >
          <LinearGradient
            colors={['#000000', '#000000', 'rgba(0,0,0,0.62)', 'rgba(0,0,0,0)']}
            locations={[0, 0.32, 0.68, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
        </Animated.View>
      </View>

      <Modal
        visible={allRecitersVisible}
        transparent
        animationType="slide"
        onRequestClose={closeQuranReciters}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.64)' }}>
          <SafeAreaView edges={selectedQuranReciter ? ['top', 'bottom'] : ['bottom']} style={{ height: selectedQuranReciter ? '100%' : '88%', backgroundColor: '#171719', borderTopLeftRadius: selectedQuranReciter ? 0 : 28, borderTopRightRadius: selectedQuranReciter ? 0 : 28, paddingTop: 18, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, marginBottom: 18 }}>
              {selectedQuranReciter ? (
                <TouchableOpacity
                  onPress={goBackFromQuranReciter}
                  accessibilityRole="button"
                  accessibilityLabel={returnToReciterList ? 'Back to Quran reciters' : 'Back to Home'}
                  style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#29292D', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
                >
                  <Ionicons name="chevron-back" size={21} color="white" />
                </TouchableOpacity>
              ) : null}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: 'white', fontSize: 25, lineHeight: 31, fontWeight: '800', letterSpacing: -0.45 }}>
                  {selectedQuranReciter ? 'Surahs' : 'Quran reciters'}
                </Text>
                <Text style={{ color: '#8E8E93', fontSize: 13, fontWeight: '500', marginTop: 3 }}>
                  {selectedQuranReciter
                    ? `${selectedQuranReciter.name} · ${quranSurahs.length || 114} surahs`
                    : availableQuranReciters.length ? `${availableQuranReciters.length} complete recitations` : 'Browse available recitations'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={closeQuranReciters}
                accessibilityRole="button"
                accessibilityLabel="Close Quran"
                style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#29292D', alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="close" size={23} color="white" />
              </TouchableOpacity>
            </View>

            {!selectedQuranReciter ? (
              <View style={{ height: 52, borderRadius: 17, backgroundColor: '#242427', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, marginHorizontal: 20, marginBottom: 13 }}>
                <Ionicons name="search" size={19} color="#8E8E93" />
                <TextInput
                  value={reciterSearch}
                  onChangeText={setReciterSearch}
                  placeholder="Search reciters"
                  placeholderTextColor="#77777D"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="Search Quran reciters"
                  style={{ flex: 1, color: 'white', fontSize: 15, fontWeight: '500', marginLeft: 10, paddingVertical: 0 }}
                />
                {reciterSearch ? (
                  <TouchableOpacity onPress={() => setReciterSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear reciter search">
                    <Ionicons name="close-circle" size={19} color="#8E8E93" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {selectedQuranReciter ? (
              quranUnavailable ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 35, paddingBottom: 35 }}>
                  <Ionicons name="cloud-offline-outline" size={29} color="#E4D6A8" />
                  <Text style={{ color: '#B7B7BC', fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 12 }}>The surah list is unavailable right now.</Text>
                  <TouchableOpacity onPress={retryQuranCatalog} activeOpacity={0.75} style={{ marginTop: 17, borderRadius: 18, paddingHorizontal: 19, paddingVertical: 11, backgroundColor: '#2B342D' }}>
                    <Text style={{ color: '#F0E5C3', fontSize: 14, fontWeight: '700' }}>Try again</Text>
                  </TouchableOpacity>
                </View>
              ) : quranLoading ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 35 }}>
                  <ActivityIndicator color="#E4D6A8" size="large" />
                  <Text style={{ color: '#A1A1A6', fontSize: 14, marginTop: 13 }}>Loading surahs…</Text>
                </View>
              ) : (
                <>
                  <View style={{ marginHorizontal: 20, marginBottom: 21, borderRadius: 24, backgroundColor: '#222623', padding: 18, overflow: 'hidden' }}>
                    <LinearGradient colors={['rgba(83,113,84,0.36)', 'rgba(34,38,35,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 110 }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ width: 58, height: 58, borderRadius: 19, backgroundColor: '#303034', alignItems: 'center', justifyContent: 'center', marginRight: 14, overflow: 'hidden' }}>
                        {selectedQuranReciter.artwork ? (
                          <ExpoImage
                            source={{ uri: selectedQuranReciter.artwork }}
                            contentFit="cover"
                            transition={180}
                            style={{ width: '100%', height: '100%' }}
                          />
                        ) : (
                          <Text style={{ color: 'white', fontSize: 23, fontWeight: '800' }}>{selectedQuranReciter.name.slice(0, 1).toUpperCase()}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: 'white', fontSize: 17, fontWeight: '800' }}>Full Quran</Text>
                        <Text numberOfLines={1} style={{ color: '#AAAAAF', fontSize: 12, fontWeight: '500', marginTop: 5 }}>{selectedQuranReciter.name}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => playQuranSurah(selectedQuranReciter, 1)}
                      activeOpacity={0.78}
                      accessibilityRole="button"
                      accessibilityLabel={`Play all surahs by ${selectedQuranReciter.name}`}
                      style={{ height: 49, borderRadius: 16, backgroundColor: '#FA5265', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 17 }}
                    >
                      <Ionicons name="play" size={17} color="white" />
                      <Text style={{ color: 'white', fontSize: 15, fontWeight: '800', marginLeft: 8 }}>Play full Quran</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 22, marginBottom: 6 }}>
                    <Text style={{ color: '#A4A4AA', fontSize: 12, fontWeight: '800', letterSpacing: 1.1 }}>ALL SURAHS</Text>
                    <Text style={{ color: '#77777D', fontSize: 12, fontWeight: '600' }}>{quranSurahs.length}</Text>
                  </View>

                  <FlatList
                    data={quranSurahs}
                    keyExtractor={(surah) => String(surah.number)}
                    contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
                    ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#303034', marginLeft: 51 }} />}
                    renderItem={({ item }) => {
                      const activeSurah = activeTrack?.provider === 'quran'
                        && activeTrack.providerId === selectedQuranReciter.edition
                        && activeTrack.id === `quran:${selectedQuranReciter.edition}:${item.number}`;
                      return (
                        <TouchableOpacity
                          onPress={() => playQuranSurah(selectedQuranReciter, item.number)}
                          activeOpacity={0.72}
                          accessibilityRole="button"
                          accessibilityLabel={`${activeSurah ? 'Play or pause' : 'Play'} surah ${item.number}, ${item.englishName}, recited by ${selectedQuranReciter.name}`}
                          style={{ minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}
                        >
                          <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: activeSurah ? 'rgba(250,82,101,0.15)' : '#252527', alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: activeSurah ? '#FA5265' : '#A1A1A6', fontSize: 12, fontWeight: '800' }}>{item.number}</Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 0, marginLeft: 13 }}>
                            <Text numberOfLines={1} style={{ color: activeSurah ? '#FA5265' : 'white', fontSize: 15, fontWeight: '700' }}>{item.englishName}</Text>
                            <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 13, marginTop: 4 }}>{item.arabicName || `Surah ${item.number}`}</Text>
                          </View>
                          <Ionicons name={activeSurah ? 'volume-high' : 'play'} size={17} color={activeSurah ? '#FA5265' : '#88888E'} />
                        </TouchableOpacity>
                      );
                    }}
                  />
                </>
              )
            ) : allRecitersLoading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 35 }}>
                <ActivityIndicator color="#E4D6A8" size="large" />
                <Text style={{ color: '#A1A1A6', fontSize: 14, marginTop: 13 }}>Loading reciters…</Text>
              </View>
            ) : allRecitersError ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 35, paddingBottom: 35 }}>
                <Ionicons name="cloud-offline-outline" size={29} color="#E4D6A8" />
                <Text style={{ color: '#B7B7BC', fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 12 }}>{allRecitersError}</Text>
                <TouchableOpacity onPress={() => void loadAllReciters()} activeOpacity={0.75} style={{ marginTop: 17, borderRadius: 18, paddingHorizontal: 19, paddingVertical: 11, backgroundColor: '#2B342D' }}>
                  <Text style={{ color: '#F0E5C3', fontSize: 14, fontWeight: '700' }}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : quranUnavailable ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 35, paddingBottom: 35 }}>
                <Ionicons name="cloud-offline-outline" size={29} color="#E4D6A8" />
                <Text style={{ color: '#B7B7BC', fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 12 }}>The surah list is unavailable right now.</Text>
                <TouchableOpacity onPress={retryQuranCatalog} activeOpacity={0.75} style={{ marginTop: 17, borderRadius: 18, paddingHorizontal: 19, paddingVertical: 11, backgroundColor: '#2B342D' }}>
                  <Text style={{ color: '#F0E5C3', fontSize: 14, fontWeight: '700' }}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : quranLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13 }}>
                <ActivityIndicator color="#E4D6A8" size="small" />
                <Text style={{ color: '#A1A1A6', fontSize: 13, marginLeft: 9 }}>Preparing surahs…</Text>
              </View>
            ) : (
              <FlatList
                data={filteredQuranReciters}
                keyExtractor={(reciter) => reciter.edition}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, flexGrow: 1 }}
                ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#303034', marginLeft: 64 }} />}
                ListEmptyComponent={(
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}>
                    <Text style={{ color: '#96969C', fontSize: 14, textAlign: 'center' }}>No reciters match that search.</Text>
                  </View>
                )}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => {
                      setReciterSearch('');
                      openQuranReciter(item, true);
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`View surahs recited by ${item.name}`}
                    style={{ minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}
                  >
                    <View style={{ width: 47, height: 47, borderRadius: 24, backgroundColor: '#303034', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {item.artwork ? (
                        <ExpoImage
                          source={{ uri: item.artwork }}
                          contentFit="cover"
                          transition={180}
                          style={{ width: '100%', height: '100%' }}
                        />
                      ) : (
                        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 19, fontWeight: '800' }}>{item.name.slice(0, 1).toUpperCase()}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
                      <Text numberOfLines={1} style={{ color: 'white', fontSize: 15, fontWeight: '700' }}>{item.name}</Text>
                      <Text numberOfLines={1} style={{ color: '#89898F', fontSize: 12, fontWeight: '500', marginTop: 4 }}>
                        {item.arabicName || '114 surahs'}
                      </Text>
                    </View>
                    {activeTrack?.provider === 'quran' && activeTrack.providerId === item.edition ? (
                      <Ionicons name="volume-high" size={20} color="#E4D6A8" />
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color="#77777D" />
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
};
