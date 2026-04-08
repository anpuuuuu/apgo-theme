const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '../templates/index.json');
const fileContent = fs.readFileSync(indexPath, 'utf8');
const jsonStart = fileContent.indexOf('{');
const comment = jsonStart > 0 ? fileContent.substring(0, jsonStart) : '';
const j = JSON.parse(jsonStart > 0 ? fileContent.substring(jsonStart) : fileContent);

const sectionId = 'custom_liquid_afAH4y';
let html = j.sections[sectionId].settings.custom_liquid;

// S2 Eng 使用獨立 ID，避免與 S2/S3 等其他區塊的 brandVideo 衝突
const suffix = 'S2Eng';

// HTML 元素 ID
html = html.replace(/id="brandVideo"/g, 'id="brandVideo' + suffix + '"');
html = html.replace(/id="particleCanvas"/g, 'id="particleCanvas' + suffix + '"');
html = html.replace(/id="loadingRing"/g, 'id="loadingRing' + suffix + '"');
html = html.replace(/id="playControl"/g, 'id="playControl' + suffix + '"');
html = html.replace(/id="progressBar"/g, 'id="progressBar' + suffix + '"');
html = html.replace(/id="statusIndicator"/g, 'id="statusIndicator' + suffix + '"');

// volumeHint 用動態 id，改為帶後綴
html = html.replace(/getElementById\('volumeHint'\)/g, "getElementById('volumeHint" + suffix + "')");
html = html.replace(/volumeHint\.id = 'volumeHint'/g, "volumeHint.id = 'volumeHint" + suffix + "'");

// JS getElementById
html = html.replace(/getElementById\('brandVideo'\)/g, "getElementById('brandVideo" + suffix + "')");
html = html.replace(/getElementById\('particleCanvas'\)/g, "getElementById('particleCanvas" + suffix + "')");
html = html.replace(/getElementById\('loadingRing'\)/g, "getElementById('loadingRing" + suffix + "')");
html = html.replace(/getElementById\('playControl'\)/g, "getElementById('playControl" + suffix + "')");
html = html.replace(/getElementById\('progressBar'\)/g, "getElementById('progressBar" + suffix + "')");
html = html.replace(/getElementById\('statusIndicator'\)/g, "getElementById('statusIndicator" + suffix + "')");

// visibilitychange 和 keydown 的 video 引用
html = html.replace(/const video = document\.getElementById\('brandVideo'\)/g, "const video = document.getElementById('brandVideo" + suffix + "')");

// querySelector 用於 .cinematic-video-section - 需要限定範圍，但 S2 Eng 的 section 是獨立的，所以 querySelector('.cinematic-video-section') 可能選到第一個。改用更精確的選擇：用 id 或 data 屬性。
// 在 section 上加 id，讓每個區塊的 script 只找自己的 section
html = html.replace('<section class="cinematic-video-section">', '<section class="cinematic-video-section" id="cinematicSection' + suffix + '">');
html = html.replace(/document\.querySelector\('\.cinematic-video-section'\)/g, "document.getElementById('cinematicSection" + suffix + "')");

j.sections[sectionId].settings.custom_liquid = html;
fs.writeFileSync(indexPath, comment + JSON.stringify(j, null, 2), 'utf8');
console.log('Done: S2 Eng unique IDs');
