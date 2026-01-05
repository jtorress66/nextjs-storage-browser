import { defineFunction, defineStorage } from "@aws-amplify/backend";

const onUploadHandler = defineFunction({
  entry: "./on-upload-handler.ts",
  resourceGroupName: "storage",
});

export const storage = defineStorage({
  name: "storage-browser-test",

  triggers: {
    onUpload: onUploadHandler,
  },

  access: (allow) => ({
    // ✅ Needed for the incoming -> UploadedProgramFiles rename/move workflow
    //    (UI uses public/incoming/ and public/UploadedProgramFiles/)
    "public/*": [
      allow.authenticated.to(["read"]),
      allow.entity("identity").to(["read", "write", "delete"]),

      // ✅ CRITICAL: allow the trigger function to copy/delete objects
      allow.resource(onUploadHandler).to(["read", "write", "delete"]),
    ],

    // ===== Existing folders from the other branch (keep them) =====
    "ConversionFiles/*": [
      allow.authenticated.to(["read"]),
      allow.entity("identity").to(["read", "write", "delete"]),
      allow.resource(onUploadHandler).to(["read", "write", "delete"]),
    ],

    "ConversionFileErrors/*": [
      allow.authenticated.to(["read"]),
      allow.entity("identity").to(["read", "write", "delete"]),
      allow.resource(onUploadHandler).to(["read", "write", "delete"]),
    ],

    "ConversionFileErrors/Mock8/*": [
      allow.authenticated.to(["read"]),
      allow.entity("identity").to(["read", "write", "delete"]),
      allow.resource(onUploadHandler).to(["read", "write", "delete"]),
    ],

    "InitialUpload/*": [
      allow.authenticated.to(["read"]),
      allow.entity("identity").to(["read", "write", "delete"]),
      allow.resource(onUploadHandler).to(["read", "write", "delete"]),
    ],

    // ===== Keep your existing folders too =====
    "InitialUploadErrors/*": [
      allow.authenticated.to(["read"]),
      allow.entity("identity").to(["read", "write", "delete"]),
      allow.resource(onUploadHandler).to(["read", "write", "delete"]),
    ],

    "TSQLFiles/*": [
      allow.authenticated.to(["read"]),
      allow.entity("identity").to(["read", "write", "delete"]),
      allow.resource(onUploadHandler).to(["read", "write", "delete"]),
    ],

    "DataValidation/*": [
      allow.authenticated.to(["read"]),
      allow.entity("identity").to(["read", "write", "delete"]),
      allow.resource(onUploadHandler).to(["read", "write", "delete"]),
    ],
  }),
});
