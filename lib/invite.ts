const DEFAULT_INVITE_ORIGIN = 'https://intown.dev';

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

export const inviteOrigin = trimTrailingSlashes(
  process.env.EXPO_PUBLIC_APP_ORIGIN || DEFAULT_INVITE_ORIGIN
);
