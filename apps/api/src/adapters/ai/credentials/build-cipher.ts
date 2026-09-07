/**
 * Composition-root factory for the real `CredentialCipher`
 * (`scripts/checks/query-boundaries.ts` rule 7 — only this directory may
 * import the cipher module). `apps/api/src/index.ts` needs a constructed
 * cipher to pass into the credential route, but may not import
 * `AesGcmCredentialCipher` itself — this is the one seam through which
 * it may ask for one.
 */
import type { CredentialCipher, KeyProvider } from '@deep-wiki/core';
import { AesGcmCredentialCipher } from '../cipher/aes-gcm-cipher';

export function buildCipher(keyProvider: KeyProvider): CredentialCipher {
  return new AesGcmCredentialCipher(keyProvider);
}
