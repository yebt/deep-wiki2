import { AesGcmCredentialCipher } from './adapters/ai/cipher/aes-gcm-cipher';

export function useCipher(cipher: AesGcmCredentialCipher) {
  return cipher;
}
