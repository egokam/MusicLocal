import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Audio, AudioContext, AudioManager, PlaybackNotificationManager, useAudioTagContext, type AudioSource } from 'react-native-audio-api';
import type { AudioLockScreenOptions, AudioMetadata } from 'expo-audio';
import type { PlayerPlaybackStatus } from '../../services/PlayerStatusStore';
import { publishPlayerPlaybackStatus } from '../../services/PlayerStatusStore';

type AudioSourceInput = AudioSource | { uri: string; headers?: Record<string, string>; name?: string };

type PlayerNowPlayingMetadata = Pick<AudioMetadata, 'title' | 'artist' | 'albumTitle' | 'artworkUrl'>;

type PlayerAudioEngineProps = {
  onStatus: (status: PlayerPlaybackStatus) => void;
  onPlayRequested: () => void;
  onPauseRequested: () => void;
  onStopRequested: () => void;
  onNextRequested: () => void;
  onPreviousRequested: () => void;
  onSeekRequested: (seconds: number) => void;
};

export type PlayerAudioEngineHandle = {
  replace: (source: AudioSourceInput) => void;
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  setVolume: (volume: number) => void;
  setMuffling: (amount: number) => void;
  setReverb: (amount: number) => void;
  setPlaybackEffects: (speed: number, pitch: number) => void;
  setActiveForLockScreen: (active: boolean, metadata?: PlayerNowPlayingMetadata, options?: AudioLockScreenOptions) => void;
  updateLockScreenMetadata: (metadata: PlayerNowPlayingMetadata) => void;
};

type AudioGraph = {
  source: ReturnType<AudioContext['createMediaElementSource']>;
  muffling: ReturnType<AudioContext['createBiquadFilter']>;
  dryGain: ReturnType<AudioContext['createGain']>;
  convolver: ReturnType<AudioContext['createConvolver']>;
  wetGain: ReturnType<AudioContext['createGain']>;
  masterGain: ReturnType<AudioContext['createGain']>;
  reverbConnected: boolean;
};

const disconnectAudioGraph = (graph: AudioGraph | null) => {
  if (!graph) return;
  graph.source.disconnect();
  graph.muffling.disconnect();
  graph.dryGain.disconnect();
  graph.convolver.disconnect();
  graph.wetGain.disconnect();
  graph.masterGain.disconnect();
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeSource = (source: AudioSourceInput): AudioSource => {
  if (typeof source === 'string' || typeof source === 'number') return source;
  return { uri: source.uri, headers: source.headers };
};

const createReverbImpulse = (context: AudioContext) => {
  const duration = 0.62;
  const frameCount = Math.floor(context.sampleRate * duration);
  const impulse = context.createBuffer(2, frameCount, context.sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const samples = impulse.getChannelData(channel);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const decay = (1 - frame / frameCount) ** 3.6;
      const earlyReflection = frame < context.sampleRate * 0.045 ? 1.25 : 1;
      samples[frame] = (Math.random() * 2 - 1) * decay * earlyReflection * 0.32;
    }
  }

  return impulse;
};

const AudioStatusReporter = ({
  onStatus,
}: {
  onStatus: (status: PlayerPlaybackStatus) => void;
}) => {
  const { currentTime, duration, playbackState } = useAudioTagContext();

  useEffect(() => {
    const nextStatus = {
      currentTime,
      duration,
      playing: playbackState === 'playing' || playbackState === 'buffering',
      didJustFinish: false,
    };
    publishPlayerPlaybackStatus(nextStatus);
    onStatus(nextStatus);
  }, [currentTime, duration, onStatus, playbackState]);

  return null;
};

export const PlayerAudioEngine = forwardRef<PlayerAudioEngineHandle, PlayerAudioEngineProps>(({
  onStatus,
  onPlayRequested,
  onPauseRequested,
  onStopRequested,
  onNextRequested,
  onPreviousRequested,
  onSeekRequested,
}, ref) => {
  const contextRef = useRef<AudioContext | null>(null);
  const [context, setContext] = useState<AudioContext | null>(null);
  const audioRef = useRef<React.ElementRef<typeof Audio>>(null);
  const graphRef = useRef<AudioGraph | null>(null);
  const reverbImpulseRef = useRef<ReturnType<AudioContext['createBuffer']> | null>(null);
  const metadataRef = useRef<PlayerNowPlayingMetadata | null>(null);
  const lockScreenActiveRef = useRef(false);
  const liveStreamRef = useRef(false);
  const statusRef = useRef<PlayerPlaybackStatus>({ currentTime: 0, duration: 0, playing: false, didJustFinish: false });
  const pendingPlayRef = useRef(false);
  const resumeAfterInterruptionRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const volumeRef = useRef(1);
  const mufflingRef = useRef(0);
  const reverbRef = useRef(0);
  const playbackRateRef = useRef(1);
  const preservePitchRef = useRef(true);
  const lastNotificationUpdateRef = useRef(0);
  const callbacksRef = useRef({ onPlayRequested, onPauseRequested, onStopRequested, onNextRequested, onPreviousRequested, onSeekRequested });

  const [source, setSource] = useState<AudioSource | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [preservesPitch, setPreservesPitch] = useState(true);
  const [audioVolume, setAudioVolume] = useState(1);
  const [audioPlaybackRate, setAudioPlaybackRate] = useState(1);

  const ensureAudioContext = useCallback(() => {
    if (contextRef.current) return contextRef.current;
    AudioManager.setSystemOptions({
      ios: { category: 'playback', mode: 'default', options: [], notifyOthersOnDeactivation: true },
    });
    AudioManager.observeAudioInterruptions('gain');
    const nextContext = new AudioContext({ latencyHint: 'interactive' });
    contextRef.current = nextContext;
    setContext(nextContext);
    return nextContext;
  }, []);

  useEffect(() => {
    callbacksRef.current = { onPlayRequested, onPauseRequested, onStopRequested, onNextRequested, onPreviousRequested, onSeekRequested };
  }, [onNextRequested, onPauseRequested, onPlayRequested, onPreviousRequested, onSeekRequested, onStopRequested]);

  const updateNotification = useCallback((playbackStatus: PlayerPlaybackStatus, force = false) => {
    if (!lockScreenActiveRef.current || !metadataRef.current) return;
    const now = Date.now();
    if (!force && playbackStatus.playing && now - lastNotificationUpdateRef.current < 2500) return;
    lastNotificationUpdateRef.current = now;
    const metadata = metadataRef.current;
    void PlaybackNotificationManager.show({
      title: metadata.title,
      artist: metadata.artist,
      ...(metadata.albumTitle ? { album: metadata.albumTitle } : {}),
      ...(metadata.artworkUrl ? { artwork: metadata.artworkUrl } : {}),
      duration: playbackStatus.duration,
      elapsedTime: playbackStatus.currentTime,
      speed: playbackStatus.playing ? playbackRateRef.current : 0,
      state: playbackStatus.playing ? 'playing' : 'paused',
      isLiveStream: liveStreamRef.current,
    }).catch(() => undefined);
  }, []);

  const reportStatus = useCallback((nextStatus: PlayerPlaybackStatus) => {
    statusRef.current = nextStatus;
    onStatus(nextStatus);
    updateNotification(nextStatus);
  }, [onStatus, updateNotification]);

  const applyMuffling = useCallback((amount: number) => {
    const normalized = clamp(amount, 0, 1);
    mufflingRef.current = normalized;
    const graph = graphRef.current;
    const context = contextRef.current;
    if (!graph || !context) return;
    const cutoff = 22000 * Math.exp(-Math.log(22000 / 720) * normalized);
    graph.muffling.frequency.setTargetAtTime(cutoff, context.currentTime, 0.045);
  }, []);

  const applyReverb = useCallback((amount: number) => {
    const normalized = clamp(amount, 0, 1);
    reverbRef.current = normalized;
    const graph = graphRef.current;
    const context = contextRef.current;
    if (!graph || !context) return;

    if (normalized > 0 && !graph.reverbConnected) {
      graph.muffling.connect(graph.convolver);
      graph.convolver.connect(graph.wetGain);
      graph.wetGain.connect(graph.masterGain);
      graph.reverbConnected = true;
    } else if (normalized === 0 && graph.reverbConnected) {
      graph.muffling.disconnect(graph.convolver);
      graph.convolver.disconnect(graph.wetGain);
      graph.wetGain.disconnect(graph.masterGain);
      graph.reverbConnected = false;
    }

    graph.wetGain.gain.setTargetAtTime(normalized * 1.4, context.currentTime, 0.06);
  }, []);

  const routeAudioThroughEffects = useCallback(() => {
    const context = contextRef.current;
    if (!context || !audioRef.current || graphRef.current) return;
    const mediaSource = context.createMediaElementSource(audioRef.current);
    const muffling = context.createBiquadFilter();
    muffling.type = 'lowpass';
    muffling.Q.value = 0.72;
    muffling.frequency.value = 22000;

    const dryGain = context.createGain();
    const convolver = context.createConvolver();
    reverbImpulseRef.current ??= createReverbImpulse(context);
    convolver.buffer = reverbImpulseRef.current;
    const wetGain = context.createGain();
    wetGain.gain.value = 0;
    const masterGain = context.createGain();

    mediaSource.connect(muffling);
    muffling.connect(dryGain);
    dryGain.connect(masterGain);
    masterGain.connect(context.destination);

    graphRef.current = {
      source: mediaSource,
      muffling,
      dryGain,
      convolver,
      wetGain,
      masterGain,
      reverbConnected: false,
    };
    applyMuffling(mufflingRef.current);
    applyReverb(reverbRef.current);
  }, [applyMuffling, applyReverb]);

  const play = useCallback(() => {
    pendingPlayRef.current = true;
    const context = contextRef.current;
    if (!context || !audioRef.current || !graphRef.current) return;
    void context.resume().then(() => {
      if (!pendingPlayRef.current) return;
      audioRef.current?.play();
      updateNotification({ ...statusRef.current, playing: true }, true);
    }).catch(() => undefined);
  }, [updateNotification]);

  const pause = useCallback(() => {
    pendingPlayRef.current = false;
    audioRef.current?.pause();
    const pausedStatus = { ...statusRef.current, playing: false, didJustFinish: false };
    statusRef.current = pausedStatus;
    publishPlayerPlaybackStatus(pausedStatus);
    onStatus(pausedStatus);
    updateNotification(pausedStatus, true);
    if (lockScreenActiveRef.current && metadataRef.current) {
      void PlaybackNotificationManager.show({
        title: metadataRef.current.title,
        artist: metadataRef.current.artist,
        ...(metadataRef.current.albumTitle ? { album: metadataRef.current.albumTitle } : {}),
        ...(metadataRef.current.artworkUrl ? { artwork: metadataRef.current.artworkUrl } : {}),
        state: 'paused',
        elapsedTime: pausedStatus.currentTime,
        duration: pausedStatus.duration,
        speed: 0,
        isLiveStream: liveStreamRef.current,
      }).catch(() => undefined);
    }
  }, [onStatus, updateNotification]);

  const seekTo = useCallback(async (seconds: number) => {
    const nextTime = Math.max(0, seconds);
    if (audioRef.current && graphRef.current) {
      audioRef.current.seekToTime(nextTime);
    } else {
      pendingSeekRef.current = nextTime;
    }
    const nextStatus = { ...statusRef.current, currentTime: nextTime, didJustFinish: false };
    statusRef.current = nextStatus;
    publishPlayerPlaybackStatus(nextStatus);
    onStatus(nextStatus);
    updateNotification(nextStatus, true);
  }, [onStatus, updateNotification]);

  const replace = useCallback((nextSource: AudioSourceInput) => {
    ensureAudioContext();
    pendingPlayRef.current = false;
    audioRef.current?.pause();
    disconnectAudioGraph(graphRef.current);
    graphRef.current = null;
    setSource(normalizeSource(nextSource));
    setSourceRevision((revision) => revision + 1);
    const resetStatus: PlayerPlaybackStatus = { currentTime: 0, duration: 0, playing: false, didJustFinish: false };
    statusRef.current = resetStatus;
    publishPlayerPlaybackStatus(resetStatus);
    onStatus(resetStatus);
  }, [ensureAudioContext, onStatus]);

  const setVolume = useCallback((volume: number) => {
    volumeRef.current = clamp(volume, 0, 1);
    setAudioVolume(volumeRef.current);
    audioRef.current?.setVolume(volumeRef.current);
  }, []);

  const setPlaybackEffects = useCallback((speed: number, pitch: number) => {
    const safeSpeed = clamp(speed, 0.5, 2);
    const safePitch = clamp(pitch, -12, 12);
    playbackRateRef.current = safeSpeed * (2 ** (safePitch / 12));
    preservePitchRef.current = safePitch === 0;
    setAudioPlaybackRate(playbackRateRef.current);
    setPreservesPitch(preservePitchRef.current);
    audioRef.current?.setPlaybackRate(playbackRateRef.current);
  }, []);

  useImperativeHandle(ref, () => ({
    replace,
    play,
    pause,
    seekTo,
    setVolume,
    setMuffling: applyMuffling,
    setReverb: applyReverb,
    setPlaybackEffects,
    setActiveForLockScreen: (active, metadata, options) => {
      lockScreenActiveRef.current = active;
      metadataRef.current = metadata ?? null;
      liveStreamRef.current = Boolean(options?.isLiveStream);
      if (!active) {
        void PlaybackNotificationManager.hide().catch(() => undefined);
      } else {
        // Prefer track navigation in iOS Control Center over the audio API's
        // default 15-second skip commands.
        void PlaybackNotificationManager.enableControl('skipForward', false).catch(() => undefined);
        void PlaybackNotificationManager.enableControl('skipBackward', false).catch(() => undefined);
        void PlaybackNotificationManager.enableControl('nextTrack', true).catch(() => undefined);
        void PlaybackNotificationManager.enableControl('previousTrack', true).catch(() => undefined);
        if (metadata && statusRef.current.playing) {
          updateNotification(statusRef.current, true);
        }
      }
    },
    updateLockScreenMetadata: (metadata) => {
      metadataRef.current = metadata;
      updateNotification(statusRef.current, true);
    },
  }), [applyMuffling, applyReverb, pause, play, replace, seekTo, setPlaybackEffects, setVolume, updateNotification]);

  useEffect(() => {
    const subscriptions = [
      PlaybackNotificationManager.addEventListener('playbackNotificationPlay', () => callbacksRef.current.onPlayRequested()),
      PlaybackNotificationManager.addEventListener('playbackNotificationPause', () => callbacksRef.current.onPauseRequested()),
      PlaybackNotificationManager.addEventListener('playbackNotificationStop', () => callbacksRef.current.onStopRequested()),
      PlaybackNotificationManager.addEventListener('playbackNotificationNextTrack', () => callbacksRef.current.onNextRequested()),
      PlaybackNotificationManager.addEventListener('playbackNotificationPreviousTrack', () => callbacksRef.current.onPreviousRequested()),
      PlaybackNotificationManager.addEventListener('playbackNotificationSeekTo', (event) => callbacksRef.current.onSeekRequested(event.value)),
    ];
    return () => subscriptions.forEach((subscription) => subscription?.remove());
  }, []);

  useEffect(() => {
    const subscription = AudioManager.addSystemEventListener('interruption', (event) => {
      if (event.type === 'began') {
        resumeAfterInterruptionRef.current = statusRef.current.playing;
        if (resumeAfterInterruptionRef.current) pause();
      } else if (event.shouldResume && resumeAfterInterruptionRef.current) {
        resumeAfterInterruptionRef.current = false;
        play();
      }
    });
    return () => subscription?.remove();
  }, [pause, play]);

  useEffect(() => () => {
    disconnectAudioGraph(graphRef.current);
    void PlaybackNotificationManager.hide().catch(() => undefined);
    void contextRef.current?.close().catch(() => undefined);
  }, []);

  const handleLoad = useCallback(() => {
    routeAudioThroughEffects();
    if (pendingSeekRef.current !== null) {
      audioRef.current?.seekToTime(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
    const context = contextRef.current;
    if (pendingPlayRef.current && context) {
      void context.resume().then(() => {
        if (!pendingPlayRef.current) return;
        audioRef.current?.setVolume(volumeRef.current);
        audioRef.current?.setPlaybackRate(playbackRateRef.current);
        audioRef.current?.play();
        updateNotification({ ...statusRef.current, playing: true }, true);
      }).catch(() => undefined);
    }
  }, [routeAudioThroughEffects, updateNotification]);

  const handleEnded = useCallback(() => {
    const finishedStatus = { ...statusRef.current, playing: false, didJustFinish: true };
    statusRef.current = finishedStatus;
    publishPlayerPlaybackStatus(finishedStatus);
    onStatus(finishedStatus);
    updateNotification(finishedStatus, true);
  }, [onStatus, updateNotification]);

  return source && context ? (
    <Audio
      key={sourceRevision}
      ref={audioRef}
      source={source}
      context={context}
      autoPlay={false}
      volume={audioVolume}
      playbackRate={audioPlaybackRate}
      preservesPitch={preservesPitch}
      onLoad={handleLoad}
      onEnded={handleEnded}
      onError={() => {
        pendingPlayRef.current = false;
        const errorStatus = { ...statusRef.current, playing: false, didJustFinish: false };
        statusRef.current = errorStatus;
        publishPlayerPlaybackStatus(errorStatus);
        onStatus(errorStatus);
      }}
    >
      <AudioStatusReporter onStatus={reportStatus} />
    </Audio>
  ) : null;
});

PlayerAudioEngine.displayName = 'PlayerAudioEngine';
