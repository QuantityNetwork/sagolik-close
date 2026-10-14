import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AzureBlobDocumentStorage } from "./blob-storage";

/** Against Azurite, Microsoft's local Blob Storage emulator (installed as a dev dependency). */
describe("Azure Blob document storage", () => {
  let azurite: ChildProcess;
  let storage: AzureBlobDocumentStorage;

  beforeAll(async () => {
    const bin = join(__dirname, "../node_modules/.bin/azurite-blob");
    azurite = spawn(bin, ["--silent", "--inMemoryPersistence", "--skipApiVersionCheck", "--blobHost", "127.0.0.1", "--blobPort", "10000"], { stdio: "ignore", cwd: mkdtempSync(join(tmpdir(), "azurite-")) });
    const client = BlobServiceClient.fromConnectionString("UseDevelopmentStorage=true");
    for (let i = 0; i < 50; i++) {
      try {
        await client.getContainerClient("documents").createIfNotExists();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    storage = new AzureBlobDocumentStorage({ client, container: "documents" });
  }, 30_000);

  afterAll(() => {
    azurite?.kill();
  });

  it("stores and reads back a document version", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 executed purchase agreement");
    await storage.put("tx-1/doc-1/v1-abcdef0123456789", bytes, "application/pdf");
    expect(await storage.get("tx-1/doc-1/v1-abcdef0123456789")).toEqual(bytes);
    expect(await storage.get("tx-1/doc-1/v2-missing")).toBeNull();
    expect(await storage.signedUrl()).toBeNull();
  });

  it("never overwrites a stored version", async () => {
    await storage.put("tx-1/doc-2/v1-0000000000000000", new Uint8Array([1, 2, 3]), "application/pdf");
    await expect(storage.put("tx-1/doc-2/v1-0000000000000000", new Uint8Array([9]), "application/pdf")).rejects.toThrow(/immutable/);
    expect(await storage.get("tx-1/doc-2/v1-0000000000000000")).toEqual(new Uint8Array([1, 2, 3]));
  });
});
