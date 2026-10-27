# Musiqapp

Musiqapp is a music player and personal music library built with Expo and React Native. It combines on-device audio storage and playback with music discovery, radio, playlists, and lyric tools.

## Features

- Import audio into the app’s private library and organize it by songs, artists, albums, playlists, and favorites.
- Edit track details and artwork, keep playback counts, and export the library as a ZIP archive with audio, artwork, lyrics, and a `library.json` manifest.
- Play music with a queue, shuffle, repeat, autoplay, background audio, and system media controls.
- Search local tracks and discover streaming tracks through Audius. Browse internet radio stations and music categories.
- Check lyrics and synchronize line timestamps for MP3 files, then save the synchronized track to the library.
- Show the current track with the iOS now-playing widget.

The local library recognizes MP3, M4A, AAC, WAV, FLAC, OGG, and Opus audio files. The LRC Synchronizer currently works with MP3 tracks.

## Branch variants

- `main` includes the Downloader entry in the Library.
- `App_Store` intentionally omits that Library entry for the App Store-oriented version.

## Tech stack

- Expo SDK 57, React Native, TypeScript, and React Navigation.
- Expo Audio and Expo File System for playback and local media storage.
- Custom native iOS modules for system media controls and the now-playing widget integration.
- Python FastAPI service code is kept separately in `backend/`.

## Project layout

| Path | Purpose |
| --- | --- |
| `App.tsx` | App shell, top-level navigation, and shared playback state. |
| `src/screens/` | Home, search, radio, library, player tools, and library sections. |
| `src/components/` | Reusable player, library, song-list, and navigation UI. |
| `src/contexts/` | Shared playback and selection state. |
| `src/services/` | Local music storage, playlists, artwork, lyrics, radio, and catalog logic. |
| `src/native/` | TypeScript interfaces for native modules. |
| `src/widgets/` | Now-playing widget code. |
| `modules/` | Custom Expo native modules. |
| `plugins/` | Expo config plugins for native integrations. |
| `backend/` | Python API and music-library service code. |
| `.github/workflows/ios-sideload.yml` | Manually triggered unsigned iOS IPA build. |

## Development

### Requirements

- Node.js 22.13 or newer and npm.
- Xcode on macOS to build and run the native iOS app locally.

### Install and start Metro

```sh
npm ci
npm start
```

The project uses custom native modules, so Expo Go does not include every app feature. Use a development build to test native functionality. On macOS with Xcode, run:

```sh
npx expo run:ios
```

### Checks

```sh
npx expo lint
npx tsc --noEmit
```

## iOS IPA builds

The repository workflow at `.github/workflows/ios-sideload.yml` builds an **unsigned** iOS IPA. In GitHub, open **Actions**, select the iOS sideload workflow, choose a branch (`App_Store` for the App Store-oriented variant), and run it. Download the `music` artifact from the completed run. The artifact is retained for seven days; sign and install the IPA with your sideloading tool.

The app version and Apple build number are set in `app.json`. Keep the package version in `package.json` and the root package entries in `package-lock.json` in sync when preparing a release.

## License

See [LICENSE](LICENSE).
