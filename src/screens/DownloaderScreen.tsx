import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { Track } from '../types';
import type { ImportProgress } from '../services/MusicCatalogService';
import { OfflineMusicService } from '../services/OfflineMusicService';

/* eslint-disable react-hooks/immutability */

type DownloaderScreenProps = {
  onBack: () => void;
  onImportAudioToLibrary: (
    url: string,
    title: string,
    artist: string,
    sourceUrl: string,
    onProgress: (progress: ImportProgress) => void,
    artworkUrl?: string,
  ) => Promise<Track>;
  onImportLocalAudioFile: (
    uri: string,
    title: string,
    artist: string,
    sourceUrl?: string,
    artworkUrl?: string,
  ) => Promise<Track>;
};

type DownloaderMode = 'track' | 'custom';

type LocalAudioSelection = {
  uri: string;
  name: string;
  extension: string;
  title: string;
  artist: string;
  lyrics: string;
  artworkUri?: string;
  added: boolean;
};

const localAudioExtension = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i;

const supportedAudioExtension = (url: URL) => /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(url.pathname);

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const encodeBase64 = (bytes: Uint8Array) => {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += base64Alphabet[first >> 2];
    encoded += base64Alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    encoded += second === undefined ? '=' : base64Alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    encoded += third === undefined ? '=' : base64Alphabet[third & 0x3f];
  }
  return encoded;
};

const TRACK_WEBSITE_URL = 'https://spotimate.app/en1';
const TRACK_PAGE_HTML = `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="dark" />
      <link rel="stylesheet" href="https://spotimate.app/css/style.min.css?v=1.5" />
      <style>
        :root { color-scheme: dark; background: #000; }
        * { box-sizing: border-box; }
        html, body { width: 100%; min-height: 100%; margin: 0; background: #000 !important; color: #F5F5F7 !important; }
        body { padding: 0 18px 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important; font-size: 16px; line-height: 1.45; }
        .track-page { width: 100%; max-width: 620px; margin: 0 auto; }
        .input-url-box { margin: 0 !important; padding: 0 !important; background: transparent !important; border: 0 !important; }
        .input-url-box .field.has-addons { display: flex !important; flex-direction: column !important; align-items: stretch !important; gap: 12px !important; margin: 0 !important; }
        .input-url-box .field.has-addons > .control:first-child { width: 100% !important; min-width: 0 !important; }
        .input-url-box .input-url { display: block !important; width: 100% !important; min-width: 0 !important; height: 64px !important; padding: 0 18px !important; border: 1px solid #38383D !important; border-radius: 22px !important; background: #1C1C1E !important; color: #F5F5F7 !important; font: inherit !important; font-size: 17px !important; box-shadow: none !important; outline: none; }
        .input-url-box .input-url::placeholder { color: #8E8E93 !important; opacity: 1; }
        .input-url-box .input-url:focus { border-color: #68686D !important; }
        .input-url-box .control-btn { display: flex !important; flex-direction: column !important; width: 100% !important; gap: 10px !important; }
        .input-url-box #paste, .input-url-box #clear { display: none !important; }
        .input-url-box .button.is-download { display: flex !important; align-items: center; justify-content: center; gap: 10px; width: 100% !important; min-height: 62px !important; padding: 0 20px !important; border: 0 !important; border-radius: 999px !important; background: #F62442 !important; color: #FFF !important; font: inherit !important; font-size: 18px !important; font-weight: 750 !important; box-shadow: none !important; }
        .download-mark { display: inline-flex; width: 24px; height: 24px; flex: 0 0 auto; }
        .input-url-box .button.is-download:disabled { opacity: .62; }
        .progress-url { position: static !important; display: none !important; width: 100% !important; height: auto !important; min-height: 22px; inset: auto !important; z-index: auto !important; visibility: visible !important; justify-content: flex-start !important; align-items: center !important; gap: 10px; padding: 8px 2px !important; background: transparent !important; color: #A1A1A6 !important; }
        .progress-url.active { display: flex !important; }
        .progress-url .spinner { position: static !important; display: inline-block; width: 18px !important; height: 18px !important; min-width: 18px; min-height: 18px; flex: 0 0 auto; border: 2px solid #48484A !important; border-top-color: #F62442 !important; border-radius: 50% !important; animation: spin .8s linear infinite; }
        .progress-url::after { content: "Finding your track…"; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .alert-box { display: none !important; margin-top: 12px !important; }
        .alert-box.active { display: block !important; }
        .alert-box .notification { margin: 0 !important; padding: 13px 15px !important; border: 1px solid #56343A !important; border-radius: 15px !important; background: #241518 !important; color: #FF9AA5 !important; font: inherit !important; font-size: 14px !important; }
        #download-info { display: flow-root; width: 100%; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 20px 0 0 !important; padding: 0 !important; background: transparent !important; color: #F5F5F7 !important; overflow-wrap: anywhere; }
        #download-info:empty { display: none !important; }
        #download-info h1, #download-info h2, #download-info h3, #download-info h4, #download-info p, #download-info label { color: #F5F5F7 !important; }
        #download-info .card, #download-info .box, #download-info .notification, #download-info [class*="result"], #download-info [class*="download"] { border-color: #2C2C2E !important; border-radius: 20px !important; }
        #download-info .button, #download-info button, #download-info input[type="submit"] { min-height: 48px; border: 0 !important; border-radius: 15px !important; background: #F62442 !important; color: #FFF !important; font: inherit !important; font-weight: 700 !important; }
        #download-info a:not(.button) { color: #FF5268 !important; }
        #download-info input:not([type="submit"]), #download-info textarea, #download-info select { max-width: 100%; border: 1px solid #38383D !important; border-radius: 14px !important; background: #1C1C1E !important; color: #F5F5F7 !important; font: inherit !important; }
        #download-info img, #download-info video { max-width: 100%; height: auto; border-radius: 16px; }
        #download-info table { display: block; max-width: 100%; overflow-x: auto; }
        #download-info .native-track-result { position: relative; isolation: isolate; display: block !important; width: 100%; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 auto !important; padding: 16px !important; background: #1C1C1E !important; color: #F5F5F7 !important; border: 1px solid rgba(255,255,255,.12) !important; border-radius: 32px !important; box-shadow: 0 14px 36px rgba(0,0,0,.32) !important; overflow: hidden; }
        #download-info .native-track-transparent { display: block !important; width: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; background: transparent !important; background-color: transparent !important; background-image: none !important; border-color: transparent !important; box-shadow: none !important; }
        #download-info .native-track-transparent::before, #download-info .native-track-transparent::after { display: none !important; content: none !important; }
        #download-info .native-track-result > div, #download-info .native-track-result div div, #download-info .native-track-result section, #download-info .native-track-result article, #download-info .native-track-result figure, #download-info .native-track-result header, #download-info .native-track-result footer { height: auto !important; min-height: 0 !important; max-height: none !important; background: transparent !important; background-color: transparent !important; background-image: none !important; box-shadow: none !important; }
        #download-info .native-track-result div:empty, #download-info .native-track-result section:empty, #download-info .native-track-result article:empty { display: none !important; }
        #download-info .native-track-result [data-single-preview], #download-info .native-track-result .sm-single-preview { margin: 0 !important; padding: 0 !important; background: transparent !important; border: 0 !important; box-shadow: none !important; }
        #download-info .native-track-result > .native-track-backdrop { position: absolute !important; z-index: 0 !important; inset: 0 !important; display: block !important; width: 100% !important; max-width: none !important; height: 100% !important; margin: 0 !important; border: 0 !important; border-radius: inherit !important; object-fit: cover !important; filter: blur(22px) saturate(1.25) !important; transform: scale(1.12); opacity: .82; pointer-events: none; }
        #download-info .native-track-result::after { content: ""; position: absolute; z-index: 1; inset: 0; border-radius: inherit; background: linear-gradient(180deg, rgba(14,12,11,.52), rgba(14,12,11,.68)); pointer-events: none; }
        #download-info .native-track-result > :not(.native-track-backdrop) { position: relative; z-index: 2; }
        #download-info .native-track-result h1, #download-info .native-track-result h2, #download-info .native-track-result h3, #download-info .native-track-result h4 { margin: 16px 0 !important; color: #F5F5F7 !important; font-size: 23px !important; font-weight: 700 !important; line-height: 1.2 !important; text-align: center !important; }
        #download-info .native-track-artwork { display: block; width: min(100%, 250px) !important; height: auto !important; margin: 0 auto 12px !important; border-radius: 28px !important; object-fit: cover; box-shadow: 0 12px 30px rgba(0,0,0,.32); }
        #download-info .sm-single-track.grid-container { display: grid !important; grid-template-columns: 58px minmax(0, 1fr) minmax(112px, 132px) !important; grid-auto-rows: min-content !important; align-content: start !important; align-items: center !important; gap: 10px !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin-top: 12px !important; padding: 8px 0 !important; border: 0 !important; border-radius: 28px !important; background: transparent !important; box-shadow: none !important; }
        #download-info .sm-single-track [data-track-name], #download-info .sm-single-track [data-track-artist], #download-info .sm-single-track .sm-track-info strong, #download-info .sm-single-track .sm-track-info > span { display: none !important; }
        #download-info .sm-single-track.grid-container > .grid-item { min-width: 0; }
        #download-info .sm-single-track .grid-text, #download-info .sm-track-info { min-width: 0; overflow-wrap: anywhere; text-align: left !important; }
        #download-info .sm-single-track [data-track-name], #download-info .sm-track-info strong { color: #F5F5F7 !important; font-size: 16px !important; font-weight: 650 !important; line-height: 1.35 !important; }
        #download-info .sm-single-track [data-track-artist], #download-info .sm-track-info > span { display: block; margin-top: 3px; color: #A1A1A6 !important; font-size: 14px !important; line-height: 1.35 !important; }
        #download-info .sm-single-track .grid-item:last-child .button, #download-info .sm-single-track .grid-item:last-child button { display: flex !important; align-items: center; justify-content: center; width: 100% !important; min-width: 0 !important; min-height: 50px !important; padding: 8px 10px !important; border-radius: 999px !important; background: #F62442 !important; color: #FFF !important; font-size: 14px !important; font-weight: 700 !important; line-height: 1.2 !important; white-space: normal !important; }
        #download-info .sm-preview { position: relative !important; display: flex !important; flex: 0 0 58px !important; width: 58px !important; min-width: 58px !important; max-width: 58px !important; height: 58px !important; min-height: 58px !important; max-height: 58px !important; aspect-ratio: 1 / 1; padding: 0 !important; border: 1px solid rgba(255,255,255,.18) !important; border-radius: 50% !important; background: #2C2C2E !important; box-shadow: 0 4px 14px rgba(0,0,0,.35) !important; overflow: hidden !important; }
        #download-info .sm-preview > img { position: absolute !important; inset: 0 !important; z-index: 0 !important; width: 100% !important; height: 100% !important; border-radius: 50% !important; object-fit: cover !important; }
        #download-info .sm-preview > [data-preview-icon] { position: relative; z-index: 1; width: 36px !important; height: 36px !important; border: 1px solid rgba(255,255,255,.2); border-radius: 50% !important; background: rgba(28,28,30,.78) !important; backdrop-filter: blur(14px); box-shadow: 0 2px 10px rgba(0,0,0,.32) !important; }
        #download-info .sm-preview svg { width: 17px !important; height: 17px !important; color: #FFF !important; }
        #download-info .sm-preview[data-native-downloading="true"] > [data-preview-icon] { opacity: 0 !important; }
        #download-info .sm-preview[data-native-downloading="true"]::after { content: ""; position: absolute; z-index: 2; width: 34px; height: 34px; border: 3px solid rgba(255,255,255,.3); border-top-color: #FFF; border-right-color: #FFF; border-radius: 50%; background: rgba(28,28,30,.72); animation: spin .75s linear infinite; }
        #download-info [data-native-hidden-progress] { display: none !important; }
        .cf-turnstile { margin-top: 8px; }
        ::selection { background: #F62442; color: #FFF; }
      </style>
      <script>
        window.handleTurnstileSuccess = function () {};
        window.handleTurnstileError = function () {
          var token = document.querySelector('input[name="cf-turnstile-response"]');
          if (token) token.value = '';
        };
      </script>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
      <script src="https://spotimate.app/js/app.min.js?v=3.13" defer></script>
    </head>
    <body>
      <main class="track-page">
        <section class="input-url-box">
          <form class="field has-addons" action="/en1" name="formurl" autocomplete="off" method="post" onchange="hiddenAlert()">
            <div class="control">
              <input name="url" class="input input-url" id="url" type="text" placeholder="Paste a Spotify track link" required aria-label="Spotify track link" autocomplete="off" autocapitalize="none" />
            </div>
            <div class="control control-btn">
              <button class="button is-paste" id="paste" type="button" onclick="onPaste()">Paste from clipboard</button>
              <button class="button is-paste" id="clear" type="button" onclick="onClear()" style="display:none">Clear link</button>
              <button class="button is-download" type="submit"><svg class="download-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 6.5v10m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Download</span></button>
            </div>
            <div class="progress-url"><div class="spinner"></div></div>
          </form>
          <div class="alert-box"><div class="notification is-warning" id="alert" role="alert"></div></div>
        </section>
        <div class="cf-turnstile" data-sitekey="0x4AAAAAACYeOrMDqxm_QIaC" data-callback="handleTurnstileSuccess" data-error-callback="handleTurnstileError" data-expired-callback="handleTurnstileError" data-timeout-callback="handleTurnstileError"></div>
        <div class="download-info" id="download-info"></div>
      </main>
    </body>
  </html>
`;
const TRACK_WEBVIEW_SOURCE = { html: TRACK_PAGE_HTML, baseUrl: TRACK_WEBSITE_URL };
const webAudioLinkBridge = `
  (function () {
    var audioExtensions = /\\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i;
    var mimeByExtension = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus' };
    function postHeight() {
      if (!window.ReactNativeWebView || !document.documentElement) return;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'track-content-height',
        height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)
      }));
    }
    var resizeQueued = false;
    function queueHeight() {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(function () { resizeQueued = false; postHeight(); });
    }
    function removeExtraDownloadActions() {
      var root = document.getElementById('download-info');
      if (!root) return;
      root.querySelectorAll('a, button, input[type="button"], input[type="submit"]').forEach(function (control) {
        var label = (control.value || control.getAttribute('aria-label') || control.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        if (label !== 'download cover [hd]' && label !== 'download another song') return;
        var parent = control.parentElement;
        control.remove();
        while (parent && parent !== root && !parent.textContent.trim()
          && !parent.querySelector('a, button, input:not([type="hidden"]), img')) {
          var nextParent = parent.parentElement;
          parent.remove();
          parent = nextParent;
        }
      });
    }
    function removePremiumUpsell() {
      var root = document.getElementById('download-info');
      if (!root) return;
      var elements = root.querySelectorAll('*');
      for (var index = elements.length - 1; index >= 0; index--) {
        var element = elements[index];
        var text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        if (!text.includes('want the full album or playlist in one zip') || !text.includes('subscribe to premium')) continue;
        var parent = element.parentElement;
        element.remove();
        while (parent && parent !== root && !parent.textContent.trim()
          && !parent.querySelector('a, button, input:not([type="hidden"]), img')) {
          var nextParent = parent.parentElement;
          parent.remove();
          parent = nextParent;
        }
      }
    }
    function styleTrackResult() {
      var root = document.getElementById('download-info');
      var preview = root && root.querySelector('[data-single-preview]');
      if (!root) return;

      function clearResultWrapper(element) {
        if (!element || element.matches('.native-track-result, .sm-single-track, .sm-preview')) return;
        element.classList.add('native-track-transparent');
        element.style.setProperty('height', 'auto', 'important');
        element.style.setProperty('min-height', '0', 'important');
        element.style.setProperty('max-height', 'none', 'important');
        element.style.setProperty('padding', '0', 'important');
        element.style.setProperty('background', 'transparent', 'important');
        element.style.setProperty('background-image', 'none', 'important');
        element.style.setProperty('box-shadow', 'none', 'important');
      }

      function findArtwork(scope) {
        return Array.from(scope.querySelectorAll('img')).filter(function (image) {
          return !image.closest('.sm-preview') && !image.classList.contains('native-track-backdrop');
        }).sort(function (first, second) {
          var firstSize = (first.clientWidth || first.naturalWidth) * (first.clientHeight || first.naturalHeight);
          var secondSize = (second.clientWidth || second.naturalWidth) * (second.clientHeight || second.naturalHeight);
          return secondSize - firstSize;
        })[0] || null;
      }

      var card = null;
      var artworkImage = null;
      var candidate;
      if (preview) {
        var fallback = preview;
        candidate = preview.parentElement;
        while (candidate && candidate !== root) {
          if (candidate.parentElement === root) fallback = candidate;
          artworkImage = findArtwork(candidate);
          if (artworkImage) {
            card = candidate;
            break;
          }
          candidate = candidate.parentElement;
        }
        if (!card && fallback !== preview) card = fallback;
      } else {
        var mp3Action = Array.from(root.querySelectorAll('a, button, input[type="button"], input[type="submit"]')).find(function (control) {
          var label = (control.value || control.getAttribute('aria-label') || control.textContent || '').replace(/\\s+/g, ' ').trim();
          return /download\\s*mp3/i.test(label);
        });
        artworkImage = findArtwork(root);
        if (mp3Action && artworkImage) {
          candidate = artworkImage.parentElement;
          while (candidate && candidate !== root && !candidate.contains(mp3Action)) candidate = candidate.parentElement;
          if (candidate && candidate !== root) card = candidate;
        }
      }

      if (card && card !== root) {
        card.classList.add('native-track-result');
        candidate = card.parentElement;
        while (candidate && candidate !== root) {
          clearResultWrapper(candidate);
          candidate = candidate.parentElement;
        }
        Array.from(card.querySelectorAll('div, section, article, figure, header, footer')).forEach(function (element) {
          clearResultWrapper(element);
        });
        artworkImage = findArtwork(card);
        if (artworkImage) artworkImage.classList.add('native-track-artwork');
        var hasBackdrop = Array.from(card.children).some(function (child) {
          return child.classList && child.classList.contains('native-track-backdrop');
        });
        if (artworkImage && !hasBackdrop) {
          var backdrop = artworkImage.cloneNode(false);
          backdrop.className = 'native-track-backdrop';
          backdrop.removeAttribute('id');
          backdrop.removeAttribute('srcset');
          backdrop.removeAttribute('sizes');
          backdrop.alt = '';
          backdrop.setAttribute('aria-hidden', 'true');
          card.insertBefore(backdrop, card.firstChild);
        }
      }
    }
    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!form || !form.matches || !form.matches('form[name="submitapurl"]')) return;
      var preview = form.closest('[data-single-preview]')
        || document.querySelector('#download-info [data-single-preview]');
      if (!preview || preview.closest('.sm-collection')) return;
      var playButton = preview.querySelector('[data-preview]');
      if (playButton) playButton.setAttribute('data-native-downloading', 'true');
      var progressId = (form.dataset.progressBar || '').replace(/^progress/, '');
      if (progressId) {
        var progressSection = document.getElementById('process-section' + progressId);
        if (progressSection) progressSection.setAttribute('data-native-hidden-progress', 'true');
        var alertWrap = document.getElementById('alert' + progressId);
        alertWrap = alertWrap && alertWrap.closest('.alert-box');
        if (playButton && alertWrap && window.MutationObserver) {
          var resetObserver = new MutationObserver(function () {
            if (!alertWrap.classList.contains('active')) return;
            playButton.removeAttribute('data-native-downloading');
            resetObserver.disconnect();
          });
          resetObserver.observe(alertWrap, { attributes: true, attributeFilter: ['class'] });
          setTimeout(function () { resetObserver.disconnect(); }, 120000);
        }
      }
    }, true);
    var downloadInfo = document.getElementById('download-info');
    if (downloadInfo && window.MutationObserver) {
      new MutationObserver(function () {
        removeExtraDownloadActions();
        removePremiumUpsell();
        styleTrackResult();
      }).observe(downloadInfo, { childList: true, subtree: true });
    }
    removeExtraDownloadActions();
    removePremiumUpsell();
    styleTrackResult();
    if (document.body && window.ResizeObserver) new ResizeObserver(queueHeight).observe(document.body);
    if (document.body && window.MutationObserver) new MutationObserver(function () {
      removeExtraDownloadActions();
      removePremiumUpsell();
      styleTrackResult();
      queueHeight();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('load', queueHeight);
    setTimeout(queueHeight, 100);
    setTimeout(queueHeight, 500);
    setTimeout(queueHeight, 1200);
    function readTrackText(root, selector) {
      if (!root) return '';
      var elements = root.querySelectorAll(selector);
      for (var index = 0; index < elements.length; index++) {
        var text = (elements[index].getAttribute('content')
          || elements[index].getAttribute('data-track-name')
          || elements[index].getAttribute('data-track-artist')
          || elements[index].getAttribute('data-artist')
          || elements[index].textContent || '').trim();
        if (text) return text;
      }
      return '';
    }
    function readAdjacentTrackText(root, titleSelector) {
      if (!root) return '';
      var titleElement = root.querySelector(titleSelector);
      var current = titleElement;
      while (current && current !== root) {
        var sibling = current.nextElementSibling;
        while (sibling) {
          var text = (sibling.innerText || sibling.textContent || '').replace(/\\s+/g, ' ').trim();
          if (text && text.length <= 100
            && !/download|subscribe|premium|want the full|playlist|zip/i.test(text)
            && !sibling.querySelector('a, button, input, img')) return text;
          sibling = sibling.nextElementSibling;
        }
        current = current.parentElement;
      }
      return '';
    }
    function usableTrackTitle(value) {
      var title = (value || '').trim();
      return /^download(?:\\s*(?:mp3|audio))?$/i.test(title) ? '' : title;
    }
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link) return;
      if (link.closest('form[name="submitapurl"]')) return;
      var url;
      try { url = new URL(link.href, location.href); } catch (_) { return; }
      var downloadName = link.getAttribute('download') || '';
      var label = [link.getAttribute('aria-label') || '', link.textContent || ''].join(' ').trim();
      var isMp3Action = /download\\s*(mp3|audio)/i.test(label);
      var extensionMatch = (downloadName || url.pathname).match(audioExtensions);
      var mimeType = link.type || (extensionMatch ? mimeByExtension[extensionMatch[1].toLowerCase()] : '');
      if (!mimeType && isMp3Action) mimeType = 'audio/mpeg';
      var isAudio = /^audio\\//i.test(mimeType) || audioExtensions.test(url.pathname) || audioExtensions.test(downloadName) || isMp3Action;
      if (!isAudio || url.protocol !== 'https:') return;
      var resultRoot = link.closest('[data-track-row]')
        || link.closest('[data-single-preview]')
        || document.querySelector('#download-info [data-single-preview]')
        || document.querySelector('#download-info [data-track-row]')
        || document.getElementById('download-info');
      var title = usableTrackTitle(link.dataset.title)
        || usableTrackTitle(readTrackText(resultRoot, '[data-track-name], [itemprop="name"], .track-title, .song-title'))
        || (downloadName && !isMp3Action ? downloadName : '');
      var artist = link.dataset.artist
        || readTrackText(resultRoot, '[data-track-artist], [data-artist], [itemprop="byArtist"], .track-artist, .song-artist, .artist-name, .artist, [class*="artist"]')
        || readAdjacentTrackText(resultRoot, '[data-track-name], [itemprop="name"], .track-title, .song-title');
      event.preventDefault();
      event.stopImmediatePropagation();
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'audio-download',
        url: url.href,
        title: title,
        artist: artist,
        mimeType: mimeType
      }));
    }, true);
  })();
  true;
`;

export const DownloaderScreen = ({
  onBack,
  onImportAudioToLibrary,
  onImportLocalAudioFile,
}: DownloaderScreenProps) => {
  const [mode, setMode] = useState<DownloaderMode>('track');
  const [tabsWidth, setTabsWidth] = useState(0);
  const [selectedAudio, setSelectedAudio] = useState<LocalAudioSelection | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [trackContentHeight, setTrackContentHeight] = useState(320);
  const previewPlayer = useAudioPlayer(null);
  const previewStatus = useAudioPlayerStatus(previewPlayer);
  const activeWebDownloads = useRef(new Set<string>());
  const tabPosition = useSharedValue(0);
  const dragOrigin = useSharedValue(0);
  const bubbleScale = useSharedValue(1);
  const tabWidth = Math.max((tabsWidth - 8) / 2, 1);

  const highlightStyle = useAnimatedStyle(() => ({
    width: tabWidth,
    transform: [
      { translateX: tabPosition.value * tabWidth },
      { scaleX: bubbleScale.value },
    ],
  }), [tabWidth]);

  const tabPan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .onStart(() => {
      dragOrigin.value = tabPosition.value;
      bubbleScale.value = withSpring(1.06, { damping: 14, stiffness: 220 });
    })
    .onUpdate((event) => {
      const nextPosition = dragOrigin.value + event.translationX / tabWidth;
      tabPosition.value = Math.min(1, Math.max(0, nextPosition));
      bubbleScale.value = Math.min(1.12, 1 + Math.abs(event.velocityX) / 9000);
    })
    .onEnd((event) => {
      const nextMode = tabPosition.value >= 0.5 ? 'custom' : 'track';
      const nextPosition = nextMode === 'custom' ? 1 : 0;
      tabPosition.value = withSpring(nextPosition, {
        damping: 15,
        stiffness: 190,
        mass: 0.7,
        velocity: event.velocityX / tabWidth,
      });
      bubbleScale.value = withSpring(1, { damping: 12, stiffness: 220 });
      scheduleOnRN(setMode, nextMode);
    });

  const selectTab = (nextMode: DownloaderMode) => {
    setMode(nextMode);
    tabPosition.value = withSpring(nextMode === 'custom' ? 1 : 0, {
      damping: 15,
      stiffness: 190,
      mass: 0.7,
    });
    bubbleScale.value = withSpring(1.04, { damping: 10, stiffness: 220 }, () => {
      bubbleScale.value = withSpring(1, { damping: 12, stiffness: 220 });
    });
    setError('');
    setMessage('');
  };

  const importWebsiteAudio = async (url: string, suggestedTitle = '', suggestedArtist = '', mimeType = '') => {
    if (activeWebDownloads.current.has(url)) return;
    let audioUrl: URL;
    try {
      audioUrl = new URL(url);
    } catch {
      return;
    }
    const audioName = suggestedTitle.trim();
    if (audioUrl.protocol !== 'https:'
      || (!supportedAudioExtension(audioUrl)
        && !/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(audioName)
        && !mimeType.toLowerCase().startsWith('audio/'))) return;

    activeWebDownloads.current.add(url);
    setError('');
    setBusy('website-audio');
    setMessage('Saving audio to your library…');
    const fileName = audioUrl.pathname.split('/').filter(Boolean).at(-1) || audioName || 'Imported audio';
    let fallbackTitle = fileName;
    try {
      fallbackTitle = decodeURIComponent(fileName);
    } catch {
      // Keep the undecoded filename when the URL contains malformed escaping.
    }
    fallbackTitle = fallbackTitle.replace(/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i, '').replace(/[-_]+/g, ' ');
    const preferredTitle = audioName.replace(/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i, '').replace(/[-_]+/g, ' ');
    try {
      const imported = await onImportAudioToLibrary(
        url,
        preferredTitle || fallbackTitle,
        suggestedArtist.trim() || 'Unknown artist',
        url,
        (progress) => setMessage(progress.message),
      );
      setMessage(`“${imported.title}” was added to your library.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this audio file.');
      setMessage('');
    } finally {
      activeWebDownloads.current.delete(url);
      setBusy('');
    }
  };

  const handleWebViewMessage = (data: string) => {
    try {
      const messageData = JSON.parse(data) as { type?: string; url?: string; title?: string; artist?: string; mimeType?: string; height?: number };
      if (messageData.type === 'track-content-height' && Number.isFinite(messageData.height)) {
        const nextHeight = Math.max(220, Math.min(Math.ceil(messageData.height ?? 0), 5000));
        setTrackContentHeight((currentHeight) => Math.abs(currentHeight - nextHeight) < 4 ? currentHeight : nextHeight);
        return;
      }
      if (messageData.type === 'audio-download' && messageData.url) {
        void importWebsiteAudio(messageData.url, messageData.title, messageData.artist, messageData.mimeType);
      }
    } catch {
      // Ignore messages that are not from the audio download bridge.
    }
  };

  const chooseAudioFile = async () => {
    setError('');
    setMessage('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const extensionMatch = asset.name.match(localAudioExtension);
      if (!extensionMatch) {
        setError('Choose an MP3, M4A, AAC, WAV, FLAC, OGG, or OPUS audio file.');
        return;
      }

      setBusy('inspecting-file');
      previewPlayer.pause();
      const metadata = await OfflineMusicService.inspectLocalAudioMetadata(asset.uri);
      const artworkUri = metadata.artworkData?.length
        ? `data:${metadata.artworkMimeType || 'image/jpeg'};base64,${encodeBase64(metadata.artworkData)}`
        : undefined;
      previewPlayer.replace(asset.uri);
      setSelectedAudio({
        uri: asset.uri,
        name: asset.name,
        extension: extensionMatch[1].toUpperCase(),
        title: metadata.title.trim() || 'Unknown',
        artist: metadata.artist.trim() || 'Unknown',
        lyrics: metadata.lyricsText?.trim() || 'Unknown',
        artworkUri,
        added: false,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that audio file.');
    } finally {
      setBusy('');
    }
  };

  const togglePreview = async () => {
    if (!selectedAudio) return;
    try {
      if (previewStatus.playing) {
        previewPlayer.pause();
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true });
      previewPlayer.play();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not play this audio preview.');
    }
  };

  const addSelectedAudioToLibrary = async () => {
    if (!selectedAudio || selectedAudio.added) return;
    setError('');
    setBusy('adding-local-file');
    setMessage('Adding audio to your library…');
    previewPlayer.pause();
    try {
      const imported = await onImportLocalAudioFile(
        selectedAudio.uri,
        selectedAudio.title,
        selectedAudio.artist,
      );
      setSelectedAudio((current) => current ? { ...current, added: true } : current);
      setMessage(`“${imported.title}” was added to your library.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add this audio file to your library.');
      setMessage('');
    } finally {
      setBusy('');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top']}>
      <View style={{ flex: 1 }}>
        <View style={{ position: 'absolute', zIndex: 5, top: 10, left: 16, right: 16, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to Library"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="chevron-back" size={26} color="white" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Alert.alert('Downloader', 'Track accepts Spotify links and shows the available download options. File imports MP3, M4A, AAC, WAV, FLAC, OGG, and OPUS audio from your device.')}
            accessibilityRole="button"
            accessibilityLabel="About downloader"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="information-circle-outline" size={23} color="#A1A1A6" />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 96, paddingBottom: 180, gap: 14 }}
          >
            <Text style={{ color: 'white', fontSize: 37, lineHeight: 44, fontWeight: '800' }}>Downloader</Text>
            <Text style={{ color: '#A1A1A6', fontSize: 15, lineHeight: 21, marginTop: -10 }}>
              {mode === 'track' ? 'Paste a Spotify link to see the available track downloads.' : 'Choose an audio file to preview its details and add it to your library.'}
            </Text>

            <GestureDetector gesture={tabPan}>
              <View
                onLayout={(event) => setTabsWidth(event.nativeEvent.layout.width)}
                style={{ height: 48, marginTop: 8, padding: 4, borderRadius: 25, backgroundColor: '#1C1C1E', flexDirection: 'row', overflow: 'hidden' }}
              >
                <Animated.View
                  pointerEvents="none"
                  style={[{ position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: 22, backgroundColor: '#39393D' }, highlightStyle]}
                />
                {(['track', 'custom'] as const).map((item) => {
                  const selected = mode === item;
                  return (
                    <TouchableOpacity
                      key={item}
                      onPress={() => selectTab(item)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={{ flex: 1, borderRadius: 22, backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}
                    >
                      <Ionicons name={item === 'track' ? 'musical-note' : 'folder-open-outline'} size={17} color={selected ? '#FA5265' : '#A1A1A6'} />
                      <Text style={{ color: selected ? 'white' : '#A1A1A6', fontSize: 14, fontWeight: '700' }}>
                        {item === 'track' ? 'Track' : 'File'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </GestureDetector>

            {mode === 'track' ? (
              <View style={{ marginBottom: 16, overflow: 'hidden', borderRadius: 20, backgroundColor: '#000000' }}>
                <WebView
                  source={TRACK_WEBVIEW_SOURCE}
                  originWhitelist={['*']}
                  style={{ height: trackContentHeight, backgroundColor: '#000000' }}
                  scrollEnabled={false}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                  injectedJavaScript={webAudioLinkBridge}
                  onMessage={(event) => handleWebViewMessage(event.nativeEvent.data)}
                  startInLoadingState
                  renderLoading={() => (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#121212' }}>
                      <ActivityIndicator color="#FA5265" />
                    </View>
                  )}
                />
              </View>
            ) : (
              <View style={{ gap: 14, marginTop: 4 }}>
                <TouchableOpacity
                  onPress={() => void chooseAudioFile()}
                  disabled={Boolean(busy)}
                  accessibilityRole="button"
                  accessibilityLabel={selectedAudio ? 'Choose another audio file' : 'Import an audio file'}
                  style={{ minHeight: 58, borderRadius: 999, borderWidth: 1, borderColor: '#38383D', backgroundColor: '#1C1C1E', flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.65 : 1 }}
                >
                  {busy === 'inspecting-file' ? <ActivityIndicator color="#FA5265" /> : <Ionicons name="folder-open-outline" size={20} color="#FA5265" />}
                  <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
                    {busy === 'inspecting-file' ? 'Reading audio details…' : selectedAudio ? 'Choose another file' : 'Import audio file'}
                  </Text>
                </TouchableOpacity>

                {selectedAudio && (
                  <View style={{ overflow: 'hidden', borderRadius: 30, borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)', backgroundColor: '#1C1C1E' }}>
                    {selectedAudio.artworkUri && (
                      <Image
                        source={{ uri: selectedAudio.artworkUri }}
                        blurRadius={28}
                        resizeMode="cover"
                        style={{ position: 'absolute', top: -20, left: -20, right: -20, bottom: -20, opacity: 0.42 }}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      />
                    )}
                    <View style={{ padding: 18, backgroundColor: 'rgba(12,12,14,0.58)', gap: 15 }}>
                      <View style={{ alignItems: 'center', gap: 13 }}>
                        <View style={{ width: 190, height: 190, overflow: 'hidden', borderRadius: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                          {selectedAudio.artworkUri ? (
                            <Image source={{ uri: selectedAudio.artworkUri }} resizeMode="cover" style={{ width: '100%', height: '100%' }} accessibilityLabel="Embedded audio artwork" />
                          ) : (
                            <View style={{ alignItems: 'center', gap: 8 }}>
                              <Ionicons name="musical-notes-outline" size={48} color="#8E8E93" />
                              <Text style={{ color: '#A1A1A6', fontSize: 13 }}>Unknown artwork</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ alignItems: 'center', gap: 3 }}>
                          <Text numberOfLines={2} style={{ color: 'white', fontSize: 21, lineHeight: 26, fontWeight: '800', textAlign: 'center' }}>{selectedAudio.title}</Text>
                          <Text numberOfLines={1} style={{ color: '#D1D1D6', fontSize: 15, lineHeight: 21, textAlign: 'center' }}>{selectedAudio.artist}</Text>
                          <Text numberOfLines={1} style={{ color: '#A1A1A6', fontSize: 12, marginTop: 3 }}>{selectedAudio.name} · {selectedAudio.extension}</Text>
                        </View>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(20,20,22,0.68)' }}>
                        <TouchableOpacity
                          onPress={() => void togglePreview()}
                          accessibilityRole="button"
                          accessibilityLabel={previewStatus.playing ? 'Pause audio preview' : 'Play audio preview'}
                          style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#F62442', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <Ionicons name={previewStatus.playing ? 'pause' : 'play'} size={23} color="white" style={previewStatus.playing ? undefined : { marginLeft: 3 }} />
                        </TouchableOpacity>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>Audio preview</Text>
                          <Text style={{ color: '#A1A1A6', fontSize: 12, marginTop: 3 }}>{previewStatus.playing ? 'Playing' : 'Ready to play'}</Text>
                        </View>
                      </View>

                      <View style={{ gap: 7 }}>
                        <Text style={{ color: 'white', fontSize: 14, fontWeight: '700' }}>Lyrics</Text>
                        <ScrollView nestedScrollEnabled style={{ maxHeight: 138, padding: 12, borderRadius: 18, backgroundColor: 'rgba(20,20,22,0.6)' }}>
                          <Text style={{ color: '#D1D1D6', fontSize: 14, lineHeight: 21 }}>{selectedAudio.lyrics}</Text>
                        </ScrollView>
                      </View>

                      <TouchableOpacity
                        onPress={() => void addSelectedAudioToLibrary()}
                        disabled={Boolean(busy) || selectedAudio.added}
                        accessibilityRole="button"
                        style={{ minHeight: 56, borderRadius: 999, backgroundColor: selectedAudio.added ? '#343438' : '#F62442', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, opacity: busy && busy !== 'adding-local-file' ? 0.55 : 1 }}
                      >
                        {busy === 'adding-local-file'
                          ? <ActivityIndicator color="white" />
                          : <Ionicons name={selectedAudio.added ? 'checkmark-circle' : 'add-circle-outline'} size={21} color="white" />}
                        <Text style={{ color: 'white', fontSize: 16, fontWeight: '800' }}>
                          {busy === 'adding-local-file' ? 'Adding to Library…' : selectedAudio.added ? 'Added to Library' : 'Add to Library'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            )}

            {Boolean(error) && (
              <Text accessibilityRole="alert" style={{ color: '#FF7280', fontSize: 14, lineHeight: 20, paddingHorizontal: 2 }}>{error}</Text>
            )}
            {Boolean(message) && !error && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
                {Boolean(busy) && <ActivityIndicator size="small" color="#FA5265" />}
                <Text style={{ flex: 1, color: '#A1A1A6', fontSize: 13, lineHeight: 19 }}>{message}</Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
};
