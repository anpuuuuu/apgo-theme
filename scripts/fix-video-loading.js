const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '../templates/index.json');
const fileContent = fs.readFileSync(indexPath, 'utf8');
const jsonStart = fileContent.indexOf('{');
const comment = jsonStart > 0 ? fileContent.substring(0, jsonStart) : '';
const j = JSON.parse(jsonStart > 0 ? fileContent.substring(jsonStart) : fileContent);

const sectionId = 'custom_liquid_afAH4y';
let html = j.sections[sectionId].settings.custom_liquid;

// 1. preload="metadata" 只載入元數據，loadeddata 不會觸發 → 改用 auto 讓影片實際載入
html = html.replace('preload="metadata"', 'preload="auto"');

// 2. 加入 loadedmetadata 作為備援：元數據載完就可隱藏 loading，不必等第一幀
html = html.replace(
  "this.video.addEventListener('loadeddata', () => { this.loadingRing.classList.add('hide'); });",
  "this.video.addEventListener('loadeddata', () => { this.loadingRing.classList.add('hide'); }); this.video.addEventListener('loadedmetadata', () => { this.loadingRing.classList.add('hide'); });"
);

// 2.2 強化：加入 canplay 與 readyState 即時判斷，避免事件在綁定前已觸發而卡 loading
html = html.replace(
  "this.video.addEventListener('loadedmetadata', () => { this.loadingRing.classList.add('hide'); });",
  "this.video.addEventListener('loadedmetadata', () => { this.loadingRing.classList.add('hide'); }); this.video.addEventListener('canplay', () => { this.loadingRing.classList.add('hide'); }); if (this.video.readyState >= 1) { this.loadingRing.classList.add('hide'); } this.video.load();"
);

// 2.5 防禦：若核心節點不存在，避免初始化過程直接中斷
html = html.replace(
  "this.hasPlayed = false; this.init(); this.createParticles();",
  "this.hasPlayed = false; if (!this.video || !this.loadingRing) { return; } this.init(); this.createParticles();"
);

// 3. 單行 custom_liquid 內含 `//` 會把後續整段 JS 註解掉，移除這些單行註解文字
const inlineCommentSnippets = [
  '// Play immediately, no delay ',
  '// Trigger earlier, only 10% into viewport ',
  '// Increase trigger range ',
  '// Ensure video plays with sound ',
  '// If audio play fails, fallback to muted play ',
  '// Show play control for users to manually enable sound ',
  '// Create volume control hint ',
  '// Ensure audio when manually playing ',
  '// Remove volume hint ',
  '// Initialization ',
  '// Page visibility handling ',
  '// Scroll parallax effect ',
  '// Reduce parallax movement range ',
  '// Apply parallax effect only when section is visible ',
  '// Block spacebar toggling/scrolling when focus is inside the cinematic video section ',
  '// Space can be \\\" \\\" or code \\\"Space\\\" ',
  '// Space can be " " or code "Space" ',
  '// If user is focused on anything inside the section (including the video), block Space ',
  '// true = capture phase (important) ',
];

for (const snippet of inlineCommentSnippets) {
  html = html.split(snippet).join('');
}

// 4. 若 script 執行時 DOMContentLoaded 已觸發，原本監聽不會再執行，改為立即初始化 fallback
html = html.replace(
  "document.addEventListener('DOMContentLoaded', () => { new CinematicVideoController(); });",
  "if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => { new CinematicVideoController(); }); } else { new CinematicVideoController(); }"
);

j.sections[sectionId].settings.custom_liquid = html;
fs.writeFileSync(indexPath, comment + JSON.stringify(j, null, 2), 'utf8');
console.log('Fixed: preload=auto, added loadedmetadata, removed inline JS comments');
