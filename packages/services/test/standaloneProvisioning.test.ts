import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodePersonalProviderConfigRepository } from "@zcode/provider-node";
import { createProviderProvisioningSource } from "../src/model-provider/providerProvisioningSource.js";
import type { ISettingService } from "../src/setting/setting.js";

test("provider provisioning never reads historical OAuth credentials or account settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-standalone-provision-"));
  try {
    const file = join(dir, "providers.json");
    const credentials = join(dir, "credentials.json");
    await writeFile(credentials, "historical unreadable credential data");
    const source = createProviderProvisioningSource({
      personalRepository: new NodePersonalProviderConfigRepository({ filePath: file }),
      personalConfigFilePath: file,
      credentialFilePath: credentials,
      settingService: {
        get: async () => {
          throw new Error("account settings must not be read");
        },
      } as unknown as ISettingService,
    });
    const envelope = await source.read("standalone-test");
    assert.deepEqual(envelope.credentials, []);
    assert.deepEqual(envelope.accountSettings, {
      providerFamilyDomain: null,
      providerFamilyConnectionSelections: {},
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
