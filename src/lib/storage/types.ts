export interface UploadInput {
  /** Storage key, e.g. "avatars/user-123.png". No leading slash. */
  key: string;
  data: Buffer;
  contentType: string;
}

export interface StorageAdapter {
  upload(input: UploadInput): Promise<void>;
  delete(key: string): Promise<void>;
  /** A URL the browser can use to fetch this file. */
  getUrl(key: string): string;
  read(key: string): Promise<Buffer>;
}
