# Security Policy

## Supported versions

Only the latest `0.3.x` release is supported.

## Reporting a vulnerability

Please use GitHub **Security Advisories** ("Report a vulnerability") or contact the maintainer privately. Do not open a public issue containing credentials.

Include:

- Userscript version and browser/Tampermonkey version
- Minimal reproduction steps
- Relevant request/response excerpts with secrets redacted

## Data and privacy

- The script does **not** store your 115 password or cookies. It relies on the browser's existing 115 session through Tampermonkey.
- There is no analytics or telemetry. Requests go only to `115.com` and the subdomains listed in the userscript `@connect` metadata.
- Tasks, settings, directory usage, and logs are stored locally in Tampermonkey GM storage.
- Deletions go to the 115 recycle bin; file/folder renames are recorded in the task summary.

## Please do not paste

- Cookie values (`UID`, `CID`, `SEID`, `KID`) or QR-login tokens
- Full diagnostic dumps containing personal paths or file names
- Private magnet links or torrent names

## Scope

The script intentionally **does not bypass** 115 human verification. A `911` response pauses all requests and asks the user to complete verification manually. Automated CAPTCHA cracking, credential stuffing, and bulk scraping are out of scope.
