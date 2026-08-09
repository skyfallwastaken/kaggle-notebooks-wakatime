import fs from "node:fs";
import assert from "node:assert/strict";

function assertPng(path, width, height, colorType) {
  const png = fs.readFileSync(path);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", `${path} is not a PNG`);
  assert.equal(png.readUInt32BE(16), width, `${path} has the wrong width`);
  assert.equal(png.readUInt32BE(20), height, `${path} has the wrong height`);
  if (colorType !== undefined) assert.equal(png[25], colorType, `${path} has the wrong PNG colour type`);
}

const manifest = JSON.parse(fs.readFileSync(".output/chrome-mv3/manifest.json", "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, "Hackatime for Kaggle Notebooks");
assert(manifest.permissions.includes("storage"));
assert.equal(manifest.version, "0.1.3");
assert.deepEqual(manifest.icons, {
  16: "icon/16.png",
  32: "icon/32.png",
  48: "icon/48.png",
  128: "icon/128.png",
});
for (const [size, icon] of Object.entries(manifest.icons)) assertPng(`.output/chrome-mv3/${icon}`, Number(size), Number(size), 6);
assert(manifest.optional_host_permissions.includes("https://*/*"));
assert(manifest.options_page || manifest.options_ui?.page);
assert.equal(manifest.background?.service_worker, "background.js");
const scripts = manifest.content_scripts;
const kaggle = scripts.find(s => s.matches.includes("https://www.kaggle.com/code/*"));
const jupyter = scripts.filter(s => s.matches.includes("https://*.jupyter-proxy.kaggle.net/*"));
assert(kaggle && jupyter.length === 2);
assert(jupyter.every(s => s.all_frames === true));
assert(jupyter.some(s => s.world === "MAIN") && jupyter.some(s => !s.world || s.world === "ISOLATED"));
for (const host of ["https://hackatime.hackclub.com/*", "https://api.wakatime.com/*"]) assert(manifest.host_permissions.includes(host));
assert(fs.readdirSync(".output/chrome-mv3/assets").some(file => file.startsWith("spline-sans-") && file.endsWith(".woff2")));
assertPng("store-assets/icon-128.png", 128, 128, 6);
assertPng("store-assets/screenshot-working-1280x800.png", 1280, 800);
assertPng("store-assets/screenshot-settings-1280x800.png", 1280, 800);
assertPng("store-assets/screenshot-kaggle-1280x800.png", 1280, 800);
assertPng("store-assets/small-promo-440x280.png", 440, 280);
assert(fs.existsSync("store-assets/CWS_SUBMISSION.md") && fs.existsSync("PRIVACY.md"));
console.log("Manifest and store assets OK: MV3, title, icons, Kaggle scripts, storage, endpoint hosts, options page, screenshots, promo image and privacy copy");
