// Native Google + Apple sign-in for the mobile app.
//
// Both use Supabase's native ID-token flow: the OS sign-in UI returns a signed
// ID token (JWT), which we hand to supabase.auth.signInWithIdToken. Supabase
// validates the token's signature + audience against the client IDs registered
// in the Google/Apple providers (web + iOS + Android client IDs, and the app
// bundle id for Apple). No web browser / redirect involved.
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';

import { supabase } from './supabase';

// Public OAuth client IDs (safe to ship — not secrets). The web client id is the
// "anchor"; iOS/Android ids are also registered as accepted audiences in Supabase.
const GOOGLE_WEB_CLIENT_ID =
  '244470461095-sk688lporglmp539uu3p20t6ofvcbcqp.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID =
  '244470461095-q8onrduod8afkbkbvvhonuhvdfoeustu.apps.googleusercontent.com';

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  iosClientId: GOOGLE_IOS_CLIENT_ID,
  scopes: ['profile', 'email'],
});

/** Native Google sign-in → Supabase session. Returns {} on success, {error} otherwise. */
export async function signInWithGoogle(): Promise<{ error?: string }> {
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) {
      return { error: 'Sign in was cancelled.' };
    }
    let idToken = response.data.idToken;
    if (!idToken) {
      // Fallback: pull the token explicitly if the sign-in payload didn't include it.
      idToken = (await GoogleSignin.getTokens()).idToken;
    }
    if (!idToken) return { error: 'Google did not return an ID token.' };
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    return { error: error?.message };
  } catch (e) {
    if (isErrorWithCode(e)) {
      // Cancellation / no-network etc. — keep the message friendly.
      return { error: e.message || 'Google sign-in failed.' };
    }
    return { error: e instanceof Error ? e.message : 'Google sign-in failed.' };
  }
}

/** Native Sign in with Apple (iOS) → Supabase session. */
export async function signInWithApple(): Promise<{ error?: string }> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      return { error: 'Apple did not return an identity token.' };
    }
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error) return { error: error.message };

    // Apple returns the user's name ONLY on the very first sign-in — capture it now.
    const given = credential.fullName?.givenName;
    const family = credential.fullName?.familyName;
    if (given || family) {
      const display_name = [given, family].filter(Boolean).join(' ');
      try {
        await supabase.auth.updateUser({ data: { display_name } });
      } catch {
        /* non-fatal — name is a nicety */
      }
    }
    return {};
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err?.code === 'ERR_REQUEST_CANCELED') return { error: 'Sign in was cancelled.' };
    return { error: err?.message ?? 'Apple sign-in failed.' };
  }
}

/** Clear any native Google session on sign-out (best-effort). */
export async function signOutGoogle(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    /* ignore */
  }
}
