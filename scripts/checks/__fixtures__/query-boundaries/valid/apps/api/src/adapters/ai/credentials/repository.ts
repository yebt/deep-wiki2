import { AesGcmCredentialCipher } from '../cipher/aes-gcm-cipher';

export function readCredential(cipher: AesGcmCredentialCipher) {
  return cipher.open();
}
