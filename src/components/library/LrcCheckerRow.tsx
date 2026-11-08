import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getMusicApiHeaders } from '../../services/MusicCatalogService';
import type { Track } from '../../types';

export type LrcCheckState = 'unchecked' | 'checking' | 'synced' | 'plain' | 'missing' | 'candidate' | 'error';

const stateLabel: Record<LrcCheckState, string> = {
  unchecked: 'Not checked',
  checking: 'Searching synced lyrics…',
  synced: 'Synced lyrics available',
  plain: 'Text lyrics only',
  missing: 'No synced lyrics found',
  candidate: 'Match found · review before saving',
  error: 'Could not check · tap to retry',
};

const stateColor: Record<LrcCheckState, string> = {
  unchecked: '#8E8E93',
  checking: '#FA5265',
  synced: '#48D17A',
  plain: '#E6B94C',
  missing: '#8E8E93',
  candidate: '#FA5265',
  error: '#FF6B5E',
};

export const LrcCheckerRow = ({
  track,
  state,
  errorMessage,
  qualityWarning,
  hasRetryCandidate = false,
  disabled: externallyDisabled = false,
  onCheck,
  onReview,
  onRetry,
  onPaste,
}: {
  track: Track;
  state: LrcCheckState;
  errorMessage?: string;
  qualityWarning?: string;
  hasRetryCandidate?: boolean;
  disabled?: boolean;
  onCheck: () => void;
  onReview: () => void;
  onRetry: () => void;
  onPaste: () => void;
}) => {
  const review = state === 'candidate' || hasRetryCandidate;
  const retryableMatch = review || hasRetryCandidate;
  const lookupDisabled = externallyDisabled || state === 'checking' || (state === 'synced' && !hasRetryCandidate);
  const pasteDisabled = externallyDisabled || state === 'checking';

  return (
    <View style={{ minHeight: 86, paddingLeft: 20, flexDirection: 'row', alignItems: 'center' }}>
      {track.artwork ? (
        <Image
          source={{ uri: track.artwork, headers: getMusicApiHeaders() }}
          resizeMode="cover"
          style={{ width: 54, height: 54, borderRadius: 8, backgroundColor: '#2C2C2E' }}
        />
      ) : (
        <View style={{ width: 54, height: 54, borderRadius: 8, backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="musical-note" size={22} color="#FA5265" />
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0, minHeight: 86, marginLeft: 12, paddingRight: 8, borderBottomWidth: 1, borderBottomColor: '#29292B', justifyContent: 'center' }}>
        <Text numberOfLines={1} style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>{track.title}</Text>
        <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 13, marginTop: 3 }}>{track.artist}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          {state === 'checking' ? (
            <ActivityIndicator size="small" color={stateColor[state]} style={{ marginRight: 5, transform: [{ scale: 0.72 }] }} />
          ) : (
            <Ionicons
              name={state === 'synced' ? 'checkmark-circle' : state === 'candidate' ? 'help-circle' : state === 'error' ? 'alert-circle' : state === 'plain' ? 'text' : 'ellipse-outline'}
              size={13}
              color={stateColor[state]}
              style={{ marginRight: 5 }}
            />
          )}
          <Text numberOfLines={state === 'error' || errorMessage || qualityWarning ? 2 : 1} style={{ color: qualityWarning ? '#E6B94C' : stateColor[state], fontSize: 11, fontWeight: '600', flex: 1 }}>
            {qualityWarning
              ? qualityWarning
              : errorMessage
              ? state === 'candidate'
                ? `Match found; incomplete search: ${errorMessage}`
                : `Lookup incomplete: ${errorMessage}`
              : stateLabel[state]}
          </Text>
        </View>
      </View>

      <View style={{ width: 76, alignItems: 'center', justifyContent: 'center', marginRight: 7 }}>
        {retryableMatch ? (
          <>
            {review ? (
              <TouchableOpacity
                onPress={onReview}
                disabled={lookupDisabled}
                accessibilityRole="button"
                accessibilityLabel={`Review synced lyric match for ${track.title}`}
                style={{ minHeight: 25, alignItems: 'center', justifyContent: 'center', opacity: lookupDisabled ? 0.48 : 1 }}
              >
                <Text style={{ color: '#FA5265', fontSize: 12, fontWeight: '700' }}>Review</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ minHeight: 25, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: stateColor[state], fontSize: 12, fontWeight: '700' }}>{state === 'synced' ? 'Ready' : 'Text'}</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={onRetry}
              disabled={lookupDisabled}
              accessibilityRole="button"
              accessibilityLabel={`Retry with a different lyric version for ${track.title}`}
              style={{ minHeight: 24, alignItems: 'center', justifyContent: 'center', opacity: lookupDisabled ? 0.48 : 1 }}
            >
              <Text style={{ color: '#FA5265', fontSize: 12, fontWeight: '700' }}>Retry</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            onPress={onCheck}
            disabled={lookupDisabled}
            accessibilityRole="button"
            accessibilityLabel={state === 'error' ? `Retry lyrics search for ${track.title}` : `Check synced lyrics for ${track.title}`}
            style={{ minHeight: 38, alignItems: 'center', justifyContent: 'center', opacity: lookupDisabled ? 0.48 : 1 }}
          >
            <Text style={{ color: state === 'unchecked' || state === 'missing' || state === 'error' || state === 'plain' ? '#FA5265' : stateColor[state], fontSize: 12, fontWeight: '700' }}>
              {state === 'synced'
                ? 'Ready'
                : state === 'checking'
                  ? ''
                  : state === 'error'
                    ? 'Retry'
                    : state === 'unchecked'
                      ? 'Check'
                      : state === 'missing'
                        ? 'Search'
                        : 'Add LRC'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={onPaste}
          disabled={pasteDisabled}
          accessibilityRole="button"
          accessibilityLabel={`Paste custom synced lyrics for ${track.title}`}
          style={{ minHeight: 32, alignItems: 'center', justifyContent: 'center', opacity: pasteDisabled ? 0.4 : 1 }}
        >
          <Text style={{ color: '#A1A1A6', fontSize: 10, fontWeight: '700' }}>Paste LRC</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
