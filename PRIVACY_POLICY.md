# Privacy Policy — Groq Transcriber for WhatsApp Web

**Last Updated:** June 5, 2026  
**Extension Name:** Groq Transcriber for WhatsApp Web  
**Developer:** Independent open-source project

---

## 1. Overview

This Privacy Policy explains how the Chrome Extension **"Groq Transcriber for WhatsApp Web"** (the "Extension") handles user data. We are committed to transparency and privacy by design.

**Summary: The developer collects NO data. No servers. No tracking. No analytics.**

---

## 2. Data the Extension Accesses

### 2.1 Voice Message Audio
When you explicitly click the transcription button on a WhatsApp Web voice message, the Extension temporarily accesses the audio file of that specific message **locally in your browser**. This audio is then sent **directly and exclusively** via encrypted HTTPS to the Groq API (`https://api.groq.com`) to obtain the text transcription.

- The audio is **not stored** anywhere by this Extension.
- The audio is **not sent** to the developer or any other third party.
- The audio is processed only by Groq, under your own API key and their own Terms of Service.

### 2.2 Groq API Key
Your Groq API key is stored **locally on your device only**, using Chrome's secure local storage API (`chrome.storage.local`). It is stored in an obfuscated format for an additional layer of protection.

- The API key is **never transmitted** to the developer.
- The API key is **never sent** anywhere except directly to `https://api.groq.com` to authenticate your transcription request.
- You can delete your API key at any time from the Extension popup.

### 2.3 Usage Quota Counters
The Extension stores local counters (requests per minute, per day; audio seconds per hour, per day) in `chrome.storage.local` to enforce Groq's free-tier rate limits on your behalf.

- These counters contain **no personal information**.
- They are stored **only on your device** and are never transmitted anywhere.

---

## 3. Data the Extension Does NOT Collect

- ❌ No browsing history
- ❌ No chat content or message text
- ❌ No contact names or phone numbers
- ❌ No location data
- ❌ No telemetry or analytics
- ❌ No crash reports sent to external servers
- ❌ No cookies

---

## 4. Third-Party Services

This Extension transmits voice audio data to **Groq, Inc.** (`https://groq.com`) exclusively for the purpose of speech-to-text transcription. This transmission occurs **only when you explicitly press the transcription button**.

By using this Extension with your own Groq API key, your audio data is subject to:
- [Groq's Privacy Policy](https://groq.com/privacy-policy/)
- [Groq's Terms of Service](https://groq.com/terms-of-use/)

No other third-party services, SDKs, or external connections are used.

---

## 5. Permissions Justification

| Permission | Reason |
|---|---|
| `storage` | To save your API Key and preferences locally on your device |
| `host_permissions: https://api.groq.com/*` | To send audio directly from your browser to the Groq API over HTTPS |

---

## 6. Disclaimer — Relationship with WhatsApp

> This Extension is an **independent, open-source project**. It is **not affiliated with, endorsed by, authorized by, or associated in any way** with WhatsApp Inc. or Meta Platforms, Inc.  
> Use of this Extension is at your own risk and subject to WhatsApp's Terms of Service.

---

## 7. Children's Privacy

This Extension is not directed at children under the age of 13. We do not knowingly collect any data from children.

---

## 8. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be reflected by updating the "Last Updated" date at the top of this document. Continued use of the Extension after changes constitutes acceptance of the updated policy.

---

## 9. Contact

For questions or concerns about this privacy policy, please open an issue on the open-source repository for this Extension.

---

*This Extension is free and open source. No personal data is collected or monetized.*
