package com.acme.notes.recipes;

import java.util.UUID;

import com.egradx.core.utils.CommonUtils;
import com.egradx.core.utils.EgradxIds;
import com.egradx.core.utils.EncryptionUtil;
import com.egradx.core.utils.RandomStringGeneratorUtil;

/**
 * The core utilities a recipe or guide shows (the portal's recipes, compiled with the Java example). Not part of the
 * generated project: kept by scripts/generate-examples.mjs.
 */
public final class SmallUtilities {

    private SmallUtilities() {
    }

    // docs:region seal-a-secret
    /**
     * A secret kept in one column: AES-256-GCM with a key wrapped under the passphrase, as one string
     * ("v1:…:…:…") that Java, Node and Python all read.
     */
    public static String seal(String apiKey, char[] passphrase) {
        return EncryptionUtil.sealText(apiKey, passphrase);
    }

    public static String open(String sealed, char[] passphrase) {
        return EncryptionUtil.openText(sealed, passphrase);   // a wrong passphrase or a changed value throws
    }
    // docs:end

    // docs:region small-utilities
    public static void examples() throws Exception {
        String code = RandomStringGeneratorUtil.generateRandomString(12);   // A–Z, a–z, 0–9, from SecureRandom
        UUID id = EgradxIds.uuidV7();                                       // time-ordered: new rows land at the index's end
        byte[] zipped = CommonUtils.getZippedContent("a long text");        // gzip
        String text = CommonUtils.getUnzippedContent(zipped);
        System.out.println(code + " " + id + " " + text);
    }
    // docs:end
}
