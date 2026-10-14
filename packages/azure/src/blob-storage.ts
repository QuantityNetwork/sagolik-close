/**
 * The document vault on Azure Blob Storage. The storage account accepts Entra
 * identities only (no account keys) and is reachable only over its private
 * endpoint, so downloads are streamed by the app's authorized, audited
 * download route rather than handed out as direct links.
 *
 * Object keys are content-addressed and never reused: a write to an existing
 * key is refused, so a stored version can't be replaced.
 */
import type { TokenCredential } from "@azure/identity";
import { BlobServiceClient, type ContainerClient, RestError } from "@azure/storage-blob";

export interface AzureBlobStorageOptions {
  /** e.g. https://stsagolikprod.blob.core.windows.net */
  accountUrl?: string;
  credential?: TokenCredential;
  /** A ready client (tests use Azurite). */
  client?: BlobServiceClient;
  container: string;
}

export class AzureBlobDocumentStorage {
  private readonly container: ContainerClient;

  constructor(opts: AzureBlobStorageOptions) {
    const service = opts.client ?? new BlobServiceClient(opts.accountUrl ?? "", opts.credential);
    if (!opts.client && (!opts.accountUrl || !opts.credential)) throw new Error("Blob storage needs an account URL and a credential.");
    this.container = service.getContainerClient(opts.container);
  }

  async put(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    try {
      await this.container.getBlockBlobClient(key).uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: mimeType },
        conditions: { ifNoneMatch: "*" },
      });
    } catch (e) {
      if (e instanceof RestError && (e.statusCode === 409 || e.statusCode === 412)) throw new Error("Object keys are immutable");
      throw e;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await this.container.getBlobClient(key).downloadToBuffer());
    } catch (e) {
      if (e instanceof RestError && e.statusCode === 404) return null;
      throw e;
    }
  }

  async signedUrl(): Promise<string | null> {
    return null;
  }
}
