// Browser stand-in for node:crypto, used when server world code runs in the preview.
export const randomUUID = (): string => globalThis.crypto.randomUUID();
