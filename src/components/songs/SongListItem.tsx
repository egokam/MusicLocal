import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '../../types';
import { getMusicApiHeaders } from '../../services/MusicCatalogService';

export type SongMenuAnchor = { x: number; y: number; width: number; height: number };

export const SongListItem = ({
  track,
  onPress,
  onDownload,
  onMore,
  showMore = true,
  downloaded,
  downloading,
  selectionMode = false,
  selected = false,
  onToggleSelected,
  addMode = false,
  alreadyAdded = false,
  adding = false,
  onAddToPlaylist,
  isLast,
}: {
  track: Track;
  onPress: () => void;
  onDownload: () => void;
  onMore?: (anchor: SongMenuAnchor) => void;
  showMore?: boolean;
  downloaded: boolean;
  downloading: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  addMode?: boolean;
  alreadyAdded?: boolean;
  adding?: boolean;
  onAddToPlaylist?: () => void;
  isLast: boolean;
}) => {
  return (
  <View
    style={{
      minHeight: 64,
      paddingLeft: 20,
      flexDirection: 'row',
      alignItems: 'center',
    }}
  >
    {track.artwork ? (
      <Image
        source={{ uri: track.artwork, ...(track.artwork.startsWith('http') ? { headers: getMusicApiHeaders() } : {}) }}
        resizeMode="cover"
        style={{ width: 50, height: 50, borderRadius: 7, backgroundColor: '#2C2C2E' }}
      />
    ) : (
      <View style={{ width: 50, height: 50, borderRadius: 7, backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="musical-note" size={21} color="#FA5265" />
      </View>
    )}
    <TouchableOpacity
      onPress={onPress}
      disabled={selectionMode}
      accessibilityRole="button"
      accessibilityState={{ disabled: selectionMode }}
      accessibilityLabel={`Play ${track.title} by ${track.artist}${track.isFavorite ? ', favorited' : ''}`}
      style={{
        flex: 1,
        minWidth: 0,
        height: 64,
        marginLeft: 12,
        paddingRight: 8,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: '#2C2C2E',
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
        <Text numberOfLines={1} style={{ flexShrink: 1, color: 'white', fontSize: 17, fontWeight: '500' }}>
          {track.title}
        </Text>
        {track.isFavorite ? (
          <Ionicons
            name="heart"
            size={13}
            color="#FA243C"
            style={{ marginLeft: 5 }}
            accessible={false}
          />
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={{ color: '#8E8E93', fontSize: 14, fontWeight: '500', marginTop: 3 }}
      >
        {track.artist}
      </Text>
    </TouchableOpacity>
    <View
      style={{
        height: 64,
        paddingLeft: 8,
        paddingRight: 16,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: '#2C2C2E',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
      }}
    >
      {selectionMode ? (
        <TouchableOpacity
          onPress={onToggleSelected}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${track.title}`}
          hitSlop={10}
          style={{ width: 34, height: 42, alignItems: 'center', justifyContent: 'center' }}
        >
          <View
            style={{
              width: 23,
              height: 23,
              borderRadius: 12,
              borderWidth: selected ? 0 : 2,
              borderColor: '#8E8E93',
              backgroundColor: selected ? '#FA243C' : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {selected ? <Ionicons name="checkmark" size={16} color="white" /> : null}
          </View>
        </TouchableOpacity>
      ) : addMode ? (
        <TouchableOpacity
          onPress={onAddToPlaylist}
          disabled={adding}
          accessibilityRole="button"
          accessibilityLabel={alreadyAdded ? `Remove ${track.title} from playlist` : `Add ${track.title} to playlist`}
          hitSlop={8}
          style={{
            width: 36,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: adding ? 0.6 : 1,
          }}
        >
          {adding ? <ActivityIndicator size="small" color="#FA5265" /> : (
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: '#3A2027',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={alreadyAdded ? 'close' : 'add'} size={21} color="#FA5265" />
            </View>
          )}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onDownload}
          disabled={!track.downloadAllowed || downloaded || downloading}
          accessibilityRole="button"
          accessibilityLabel={downloaded ? `${track.title} is downloaded` : `Download ${track.title}`}
          style={{
            width: 24,
            height: 28,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: track.downloadAllowed ? 1 : 0.35,
          }}
        >
          {downloading ? (
            <ActivityIndicator size="small" color="#8E8E93" />
          ) : (
            <View
              style={{
                width: 19,
                height: 19,
                borderRadius: 10,
                backgroundColor: '#2C2C2E',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={downloaded ? 'checkmark' : 'arrow-down'} size={12} color="#8E8E93" />
            </View>
          )}
        </TouchableOpacity>
      )}
      {showMore && !selectionMode ? (
          <TouchableOpacity
            onPress={(event) => {
              const { pageX, pageY, locationX, locationY } = event.nativeEvent;
              onMore?.({ x: pageX - locationX, y: pageY - locationY, width: 28, height: 40 });
            }}
            accessibilityRole="button"
            accessibilityLabel={`More options for ${track.title}`}
            hitSlop={10}
            style={{ width: 28, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="ellipsis-horizontal" size={23} color="white" />
          </TouchableOpacity>
      ) : null}
    </View>
  </View>
  );
};
