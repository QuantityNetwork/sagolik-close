/**
 * Object storage for the document vault. Keys are content-addressed and
 * never reused, so a stored version can't be overwritten.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { globalSingleton } from "@sagolik/integrations";

export interface DocumentStorage {
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** Short-lived URL for direct download, or null when the app should stream the bytes itself. */
  signedUrl(key: string, ttlSeconds: number, downloadName: string): Promise<string | null>;
}

export function objectKey(transactionId: string, documentId: string, version: number, sha256: string): string {
  return `${transactionId}/${documentId}/v${version}-${sha256.slice(0, 16)}`;
}

export class MemoryDocumentStorage implements DocumentStorage {
  private objects = globalSingleton("memory_document_storage", () => new Map<string, { bytes: Uint8Array; mimeType: string }>());
  async put(key: string, bytes: Uint8Array, mimeType: string) {
    if (this.objects.has(key)) throw new Error("Object keys are immutable");
    this.objects.set(key, { bytes: new Uint8Array(bytes), mimeType });
  }
  async get(key: string) {
    return this.objects.get(key)?.bytes ?? null;
  }
  async signedUrl() {
    return null;
  }
}

export class SupabaseDocumentStorage implements DocumentStorage {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket = "documents",
  ) {}
  async put(key: string, bytes: Uint8Array, mimeType: string) {
    const { error } = await this.client.storage.from(this.bucket).upload(key, bytes, { contentType: mimeType, upsert: false });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
  }
  async get(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
  async signedUrl(key: string, ttlSeconds: number, downloadName: string) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(key, ttlSeconds, { download: downloadName });
    if (error || !data) return null;
    return data.signedUrl;
  }
}
