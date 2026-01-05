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
    // ✅ App access to all public files (incoming + UploadedProgramFiles live under public/*)
    "public/*": [
      allow.authenticated.to(["read"]),
      allow.entity("identity").to(["read", "write", "delete"]),

      // ✅ CRITICAL: allow the trigger function to copy/delete objects
      allow.resource(onUploadHandler).to(["read", "write", "delete"]),
    ],

    // keep your other folders as you had them
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
