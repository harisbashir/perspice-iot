Your own account lives under **Settings → My profile** (also in the account menu at the top right).

## Profile and password

- **Name**: how you appear to colleagues and in the audit log.
- **Change password**: enter your current password and a new one of at least 10 characters. Your other sessions (other browsers and devices) are signed out.

Forgot your password? On the sign-in page choose *Forgot your password?*, enter your email, and follow the link in the email to set a new one.

After 5 wrong passwords in a row, the account is locked for 15 minutes (longer if it happens again). This protects you against guessing.

## Two-factor authentication

Two-factor authentication asks for a 6-digit code from an app on your phone, as well as your password. Even someone who learns your password can't sign in without your phone.

1. Install an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).
2. **Set up two-factor authentication**, scan the QR code with the app, and enter the 6-digit code it shows.
3. From then on, signing in asks for the current code.

To turn it off, enter a current code under **Code to turn it off**. If you lose your phone, ask an admin in your organisation to help you regain access.

## API keys

Other systems (your ERP, a reporting tool, a script) can read data or act through the API with an **API key**. Under **Settings → API keys → New API key**, give it a name, the permissions it needs (only ones you have, e.g. `device.read` and `telemetry.read` to read data) and an expiry. The key is shown once: copy it into the other system, which sends it as `Authorization: Bearer pk_…`.

A key stops working when it expires, when you revoke it, or when your account is disabled. Admins can see and revoke everyone's keys in your organisation, for example when someone leaves.

## Appearance

The sun/moon button in the top bar switches between light and dark themes.

## Signing out

Account menu → **Sign out**. Disabling a user or changing their role also signs them out everywhere.

:::platform
## For platform users

Super admins must enrol in two-factor authentication when **Require two-factor authentication for super admins** is on (**Settings → Security**); until they enrol they can only manage their own account. Lockouts double with each repeat (up to 24 hours) and reset after a successful sign-in. A platform admin can reset a user's access by deleting and re-inviting them, or by disabling and re-enabling the account.
:::
