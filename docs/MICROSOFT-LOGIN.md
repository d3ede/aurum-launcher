# Microsoft sign-in in Aurum

Click **Sign in with Microsoft** to open Microsoft's actual sign-in page in a separate WebView2 window owned by the launcher. After account selection and consent, the window closes and Aurum completes sign-in automatically. No system browser tab opens, and players do not need to enter a code, token, or Client ID. Passwords and two-factor authentication are handled by Microsoft.

Aurum's dialog shows preparation, confirmation, Minecraft Java connection, and the result. Players can return to the Microsoft window, cancel, retry, or continue to their instances. Closing the Microsoft window cancels the current attempt. Both themes share the home screen's `TerrainPattern`.

## One-time developer setup

1. Open [Microsoft Entra](https://entra.microsoft.com/) and go to **Entra ID → App registrations → New registration**.
2. Name the application **Aurum Launcher**. Select **Personal Microsoft accounts only**. An option that includes both organizational and personal accounts also works; the launcher uses the `consumers` endpoint.
3. Click **Register**, then copy the **Application (client) ID** from **Overview**.
4. Open **Authentication → Add a platform → Mobile and desktop applications**. Add **`http://localhost`** and save. Do not select Web or SPA. No client secret is required.
5. Put the public ID in `config/microsoft-client-id.txt` and rebuild. The current implementation already includes the project owner's ID, `5800f49c-6f6b-4808-9c89-dabd305c8dd8`.

For a separate build, override the ID at compile time:

```powershell
$env:AURUM_MICROSOFT_CLIENT_ID = 'your-application-client-id'
./scripts/desktop.ps1 -Mode build
```

The Client ID is public and may be stored in source control. Never put a client secret, account password, or token in that file.

References: [Microsoft app registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [Authorization Code with PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), and [localhost redirect rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#localhost-exceptions).

## Minecraft access and real-account verification

Entra registration and a Client ID alone do not confirm access to Minecraft Services. Verify each step: Microsoft account selection, consent, Xbox/XSTS token exchange, Minecraft Services access, and retrieval of the Java profile. If Minecraft Services returns 403, the developer needs to clarify application access with Minecraft support. Older access-request links could not be verified; this guide does not promise that such an application form is currently available.

Use an account that owns Minecraft Java and has an Xbox profile. If Microsoft rejects the application before redirecting, check support for personal accounts and the native redirect `http://localhost`. Do not publish tokens, authorization codes, or passwords in reports. Sessions created with a different Client ID before this update may require a new sign-in.

## Implementation and verification limits

The native OAuth implementation uses Authorization Code with PKCE S256 and a random `state`. A temporary listener binds only to IPv4 loopback on an available port; Microsoft allows different ports for a registered `http://localhost` redirect. It validates the path, session state, and ambiguous parameters. Waiting is limited to ten minutes; cancellation stops the listener and network requests. Arbitrary requests and callbacks from other sessions cannot complete sign-in.

The authorization code and PKCE verifier never reach the interface or events. Tokens are refreshed automatically and saved in the OS credential vault together with the issuing application's ID. After a valid Microsoft response, the window closes and the result appears in Aurum. The Microsoft window uses a separate WebView2 profile and cannot access launcher IPC commands. The existing `http://localhost` native redirect is retained; Entra does not need to be reconfigured for the embedded window.

Automated checks use a local HTTP callback and mocked UI IPC to cover consent, denial, cancellation, retries, failure to open the sign-in window, and both themes. They do not confirm successful Microsoft sign-in or the new Client ID's Minecraft Services access; those require a real account and a configured application.

To check real WebView2 without entering credentials, use `scripts/native-microsoft-smoke.mjs`. Build the diagnostic binary with the separate identifier `app.auren.launcher.auth-smoke`; the script uses a new directory under `.test-data/`. Window creation, focus restoration, cancellation on close, and the absence of newly added accounts were confirmed. This does not confirm a complete Minecraft Services sign-in.
