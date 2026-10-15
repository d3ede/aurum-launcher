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

**An ordinary Entra App Registration is not sufficient for a new Minecraft Java API integration.** Minecraft's official [Java Edition Game Service API Review or Application Process](https://help.minecraft.net/hc/en-us/articles/16254801392141) states that new third-party applications must be manually reviewed and added to an allow list. This is separate from Microsoft account consent and Xbox token exchange. The article and its linked form were verified in a rendered browser on 15 October 2026; the article body was missing from the text-only web reader.

The article links directly to [AppID Review](https://aka.ms/mce-reviewappid). The form requests:

- Confirmation that the applicant has read the EULA and Usage Guidelines.
- A valid contact email that can be cross-referenced with the Azure Portal.
- Request type **New AppID for Approval**.
- Application name **Aurum Launcher** and Client ID `5800f49c-6f6b-4808-9c89-dabd305c8dd8`.
- The application's actual Directory (Tenant) ID from Entra Overview; it is not present in this repository.
- A website/domain describing the application, and a valid justification for API access.

The form excludes applications that bypass authentication, licensing or safety checks, lists restrictions on application names, and says submissions are reviewed weekly. This is a review cadence, not an approval deadline. The article lists `enforce@minecraft.net` for questions. Neither the article nor this form instructs Java launcher developers to enroll in ID@Xbox; do not substitute general Xbox publishing advice for this Minecraft-specific process. No form was submitted during this investigation and Aurum's approval history has not been independently verified.

If Minecraft Services returns 403, inspect its actual error description before concluding that missing approval caused that particular response. The sign-in dialog preserves the HTTP status and recognized error fields (`error`, `errorMessage`, `error_description`, `message`, `path`, `developerMessage`, `requestId`, `correlationId`), plus `x-request-id` when present. These values retain the server's wording. It reports absent, unreadable or oversized descriptions instead of guessing a cause. It reads at most 16 KiB and displays at most 1,500 diagnostic characters. It does not dump raw responses or request bodies to disk or console: token fields are excluded, and credentials used in the request are redacted if echoed in a diagnostic message. HTML error pages and malformed JSON are not dumped into the dialog.

On 15 October 2026, the project owner retried sign-in using the diagnostic build and supplied this actual dialog result:

```text
Minecraft Services: HTTP 403 Forbidden. errorMessage: Invalid app registration, see https://aka.ms/AppRegInfo for more information; path: /authentication/login_with_xbox
```

This confirms a Minecraft application-registration rejection for the current build. This text contains the server's diagnostic fields, not a byte-for-byte capture of its complete HTTP body. No request ID was present in the supplied result. The Client ID used by this build came from `config/microsoft-client-id.txt` without a compile-time override. The next step is to request Minecraft API approval for that same ID through the official form, or contact the listed enforcement address if it was already approved. Changing OAuth scopes, adding a desktop client secret, or substituting another launcher's Client ID is not a justified response to this diagnostic.

### Current chain audit (15 October 2026)

| Step | Current implementation | Evidence and limits |
| --- | --- | --- |
| Microsoft authorization | `consumers/oauth2/v2.0/authorize`, code flow, PKCE S256, random state, `XboxLive.signin offline_access`, localhost callback | Native public-client PKCE is documented by Microsoft; no client secret is appropriate. Localhost port matching is documented separately. The separate WebView2 and localhost redirect are retained; no claim is made that this is Microsoft's preferred embedded-browser redirect. |
| Microsoft token exchange | Same client, redirect and scope; authorization code and verifier sent only to `/token` | The reported Minecraft-stage failure means this request supplied an access token. This does not independently verify all Entra portal settings. |
| Xbox Live | RPS user authentication, `d=` access-token ticket, `http://auth.xboxlive.com` relying party, JWT | Required Xbox token was obtained before the reported failure. Microsoft's title-website example also sends `x-xbl-contract-version: 1`; Aurum currently omits this header. This is a difference to review separately, not evidence for the later Minecraft 403. |
| XSTS | `RETAIL` sandbox, Xbox user token, `rp://api.minecraftservices.com/` relying party | Non-success replies stop the chain. Reaching Minecraft requires an XSTS token and its user hash. |
| Minecraft sign-in | `POST /authentication/login_with_xbox`, `identityToken` formed as `XBL3.0 x=<XSTS user hash>;<XSTS token>` | The original screenshot proved only HTTP 403 because `error_for_status()` discarded the body. The owner's fresh attempt with this diagnostic build returned `Invalid app registration`; see the exact dialog text above. |
| Ownership and profile | Minecraft token used for `/entitlements/mcstore` and `/minecraft/profile` | Not reached after this 403. Ownership/profile failures cannot explain this earlier response. Real-account and Game Pass entitlement coverage remain unverified. |
| Persistence and refresh | Account and credentials saved only after profile success; issuing Client ID retained; refresh repeats Xbox/XSTS/Minecraft exchange | No failed-attempt credentials are available for replay. Refresh with a real account remains unverified. |

References: [Microsoft OAuth code/PKCE protocol](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [localhost redirect rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#localhost-exceptions), and [Xbox services sign-in for title websites](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/fundamentals/s2s-auth-calls/service-authentication/live-website-authentication). The Xbox example describes a confidential website client; its client secret and title-service configuration must not be copied into a distributed native launcher. Xbox documentation is not a public specification of Minecraft's private service implementation. No OAuth endpoint, scope, Client ID, request payload, or token-storage behavior was changed during this diagnostic task.

Use an account that owns Minecraft Java and has an Xbox profile. If Microsoft rejects the application before redirecting, check support for personal accounts and the native redirect `http://localhost`. Do not publish tokens, authorization codes, or passwords in reports. Sessions created with a different Client ID before this update may require a new sign-in.

## Implementation and verification limits

The native OAuth implementation uses Authorization Code with PKCE S256 and a random `state`. A temporary listener binds only to IPv4 loopback on an available port; Microsoft allows different ports for a registered `http://localhost` redirect. It validates the path, session state, and ambiguous parameters. Waiting is limited to ten minutes; cancellation stops the listener and network requests. Arbitrary requests and callbacks from other sessions cannot complete sign-in.

The authorization code and PKCE verifier never reach the interface or events. Tokens are refreshed automatically and saved in the OS credential vault together with the issuing application's ID. After a valid Microsoft response, the window closes and the result appears in Aurum. The Microsoft window uses a separate WebView2 profile and cannot access launcher IPC commands. The existing `http://localhost` native redirect is retained; Entra does not need to be reconfigured for the embedded window.

Automated checks use a local HTTP callback and mocked UI IPC to cover consent, denial, cancellation, retries, failure to open the sign-in window, and both themes. They do not confirm successful Microsoft sign-in or the new Client ID's Minecraft Services access; those require a real account and a configured application.

To check real WebView2 without entering credentials, use `scripts/native-microsoft-smoke.mjs`. Build the diagnostic binary with the separate identifier `app.auren.launcher.auth-smoke`; the script uses a new directory under `.test-data/`. Window creation, focus restoration, cancellation on close, and the absence of newly added accounts were confirmed. This does not confirm a complete Minecraft Services sign-in.
