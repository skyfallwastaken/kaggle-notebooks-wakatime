# Chrome Web Store submission pack

This directory contains ready to upload Chrome Web Store graphics. Upload the release ZIP as the extension package. The required 128 by 128 icon is already inside that ZIP at `icon/128.png`.

## Single purpose

Paste this into **Privacy practices > Single purpose**:

> Hackatime for Kaggle Notebooks records coding activity from Kaggle notebook editors and sends WakaTime compatible heartbeats to Hackatime or another HTTPS endpoint selected by the user.

## Permission justifications

Paste this into the **Host permission** justification:

> Access to `www.kaggle.com/code/*` is required to identify the notebook being edited. Access to Kaggle Jupyter proxy frames is required to observe the notebook editor and calculate notebook-wide line totals, line number, cursor position, language, imported package names and edit metrics. Access to Hackatime and WakaTime is required to send authenticated heartbeats to the configured service. Optional HTTPS access is not granted by default. It is requested only when the user explicitly saves a custom WakaTime compatible HTTPS endpoint.

Paste this into the **storage** justification:

> Storage is required to retain the user's API key, selected heartbeat endpoint, random machine identifier and last heartbeat times between sessions. Session storage retains current notebook metadata and per-notebook throttling state. Notebook source is not stored and is not included in heartbeat requests.

## Remote code

Select **No, I am not using remote code**.

All extension logic and fonts are packaged in the release ZIP. Kaggle notebook content is data processed by packaged extension code. No JavaScript or WebAssembly is downloaded or executed by the extension.

## Data use disclosures

Chrome requires disclosure even when data is processed only on the user's device. Select these data types:

- **Personally identifiable information** because the Kaggle account name in the notebook path is included in the heartbeat entity
- **Authentication information** because the extension stores the user's API key locally and sends it to the configured endpoint in the authorisation header
- **Web history** because the current Kaggle notebook path is processed and its stable notebook identity is transmitted
- **User activity** because coding, cursor and save activity is measured and transmitted
- **Website content** because notebook source is read locally to calculate metrics and imported package names are transmitted

Do not select financial and payment information, health information, personal communications or location. The extension does not handle those data types.

Certify all of the following:

- Data is not sold to third parties
- Data is not used or transferred for purposes unrelated to the extension's single purpose
- Data is not used or transferred to determine creditworthiness or for lending purposes
- Data use complies with the Chrome Web Store User Data Policy, including Limited Use requirements

## Privacy policy

After `v0.1.3` is pushed, use this public URL in the privacy policy field:

`https://github.com/skyfallwastaken/kaggle-notebooks-wakatime/blob/v0.1.3/PRIVACY.md`

## Store listing copy

### Summary

> Track coding time in Kaggle Notebooks with complete WakaTime compatible heartbeats.

### Description

> Hackatime for Kaggle Notebooks records coding activity while you edit Kaggle notebooks. It sends WakaTime compatible heartbeats with the notebook path, project, language, imported package names, line totals, line number, cursor position and measured edit counts.
>
> The default endpoint is Hackatime. You can use WakaTime or another compatible HTTPS endpoint from extension settings.
>
> Notebook source is processed locally to calculate metrics and is never included in heartbeat requests. Your API key stays in Chrome extension storage and is sent only to the endpoint you select.

Suggested category: **Developer Tools**.

## Graphics to upload

- `icon-128.png` as the store icon if the dashboard asks for it separately
- `screenshot-working-1280x800.png` as the primary screenshot
- `screenshot-settings-1280x800.png`
- `screenshot-kaggle-1280x800.png`
- `small-promo-440x280.png`

The primary screenshot combines a real authenticated Kaggle notebook with metrics from its captured heartbeat. The results panel is clearly labelled as captured data and is not presented as injected extension UI. The settings screenshot uses the current packaged extension and a masked preview key. No Kaggle cookie, API key or identity is visible in any image.

Official image requirements: <https://developer.chrome.com/docs/webstore/images>
