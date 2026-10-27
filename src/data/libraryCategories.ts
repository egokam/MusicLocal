import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export type LibraryCategory = {
  id: string;
  title: string;
  icon: ComponentProps<typeof Ionicons>['name'];
};

export const libraryCategories: LibraryCategory[] = [
  { id: '1', title: 'Playlists', icon: 'list-outline' },
  { id: '2', title: 'Artists', icon: 'mic-outline' },
  { id: '3', title: 'Albums', icon: 'albums-outline' },
  { id: '4', title: 'Songs', icon: 'musical-note' },
  { id: '5', title: 'LRC Checker', icon: 'time-outline' },
  { id: '6', title: 'LRC Synchronizer', icon: 'sync-outline' },
  { id: '7', title: 'Favorites', icon: 'heart-outline' },
];
