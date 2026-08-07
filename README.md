# Kaggle Notebooks WakaTime

A browser extension that records coding activity from Kaggle Notebooks and sends WakaTime compatible heartbeats to Hackatime.

## Install

1. Run `bun install` then `bun run build`.
2. Open the browser extension manager and enable developer mode.
3. Choose Load unpacked and select `.output/chrome-mv3`.
4. Open the extension options, enter your API key then save.
5. Open a Kaggle notebook edit page.

The API endpoint defaults to Hackatime. A compatible HTTPS WakaTime endpoint can be entered in options. Chrome asks for access to the selected endpoint when you save it. If permission is denied, the settings are not saved.

## Data and privacy

The extension sends the stable notebook path, project, language, imported package names, cursor location, line totals and measured edit counts. Notebook source and the API key are never included in heartbeat JSON. The key remains in extension local storage. A random machine identifier is generated locally. Activity is throttled per notebook for 120 seconds. Only an explicit save bypasses throttling.

The preferred source is the live JupyterLab notebook model. If Kaggle does not expose that model, the bridge attempts the same origin Jupyter Contents API. Its final fallback reads visible cells from the page. Since JupyterLab virtualises cells, this final mode can report only a partial notebook. Kaggle interface or Jupyter API changes may require an extension update.

## Development

Tests always load the built extension against a real Kaggle notebook. Put the testing account's cookie header in `.env` as `KAGGLE`. The default notebook is a dedicated disposable draft. Set `KAGGLE_NOTEBOOK_URL` to use another dedicated one-cell draft.

`bun run test` builds the extension, starts Vitest Browser Mode in headless Chromium then opens real Kaggle. The test appends three marked lines to the sole cell, verifies notebook-wide positions, edit measurements, dependencies and save behaviour then restores the exact source and verifies it again after a reload. It fails instead of skipping when the cookie is missing or Kaggle cannot be reached. Chromium routes Hackatime and WakaTime API hosts to a local HTTPS capture server so test heartbeats cannot reach either service.

Run `bun run typecheck` and `bun run check:manifest` for the remaining checks.
