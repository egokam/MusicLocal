import { expoClient } from '@better-auth/expo/client';
import { emailOTPClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';

export const AUTH_API_URL =
  process.env.EXPO_PUBLIC_AUTH_URL ?? 'https://auth.egokam.site';

export const authClient = createAuthClient({
  baseURL: AUTH_API_URL,
  plugins: [
    expoClient({
      scheme: 'musiqapp',
      storagePrefix: 'musiqapp',
      storage: SecureStore,
    }),
    emailOTPClient(),
    twoFactorClient(),
  ],
});

export type TwoFactorSettings = {
  twoFactorEnabled: boolean;
  emailOtpEnabled: boolean;
  authenticatorConfigured: boolean;
  authenticatorEnabled: boolean;
  emailVerified: boolean;
};

export type TwoFactorSettingsAction =
  | { action: 'master'; enabled: boolean; password?: string }
  | { action: 'email'; enabled: boolean; password?: string }
  | { action: 'authenticator'; enabled: boolean; password?: string }
  | { action: 'reset-authenticator'; password?: string };

export const getTwoFactorSettings = () =>
  authClient.$fetch<TwoFactorSettings>('/two-factor/settings', { method: 'GET' });

export const updateTwoFactorSettings = (body: TwoFactorSettingsAction) =>
  authClient.$fetch<{ status: boolean }>('/two-factor/settings/update', { method: 'POST', body });
