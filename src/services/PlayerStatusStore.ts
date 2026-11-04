import { useSyncExternalStore } from 'react';

export type PlayerPlaybackStatus = {
  currentTime: number;
  duration: number;
  playing: boolean;
  didJustFinish: boolean;
};

let status: PlayerPlaybackStatus = {
  currentTime: 0,
  duration: 0,
  playing: false,
  didJustFinish: false,
};

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => status;

export const publishPlayerPlaybackStatus = (nextStatus: PlayerPlaybackStatus) => {
  status = nextStatus;
  listeners.forEach((listener) => listener());
};

export const usePlayerPlaybackStatus = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
