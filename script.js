/**
 * ============================================
 * 婚禮解謎遊戲 — 遊戲邏輯
 * ============================================
 * 一般情況下不需要修改這個檔案。
 * 想換題目、答案、提示，請改 config.js。
 */

(() => {
  const STORAGE_KEY = "wedding-puzzle-progress-v1";
  const LANG_KEY = "wedding-puzzle-lang-v1";

  /** ---- 語言系統 ----
   * 支援三種「語言」：
   *   zh     — 繁體中文，原文照顯示
   *   dog    — 狗狗語彩蛋，所有文字變成「汪」
   *   decode — 看懂亂碼：有 decodedPrompt 的關卡會改顯示解碼後的題目
   */
  const UI_STRINGS = {
    startBtn: "開始解謎",
    submitBtn: "送出答案",
    hintBtn: "需要提示嗎？",
    restartBtn: "重新遊玩",
    answerPlaceholder: "輸入答案…",
    settingsTitle: "設置",
    returnBtn: "返回遊戲",
    resetBtn: "重設進度",
    resetConfirm: "確定要清空目前的解謎進度嗎？這個動作無法復原。",
    langNameZh: "中文",
    langNameDog: "狗狗語",
    langNameDecode: "看懂亂碼",
    feedbackCorrect: "答對了！翻開下一頁…",
    feedbackWrong: "還不太對，再想想看？",
    matchPlaceholder: "請選擇…",
  };

  function loadLang() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      return saved === "dog" || saved === "decode" ? saved : "zh";
    } catch (e) {
      return "zh";
    }
  }

  function saveLang(l) {
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch (e) {
      // 存不了就算了，這次先玩，語言下次重選
    }
  }

  let lang = loadLang();

  /** 狗狗語：把每個非空白字元都換成「汪」，換行與空白保留排版 */
  function toDogSpeak(str) {
    if (!str) return str;
    return str.replace(/[^\s]/g, "汪");
  }

  /** 依目前語言決定要不要把文字轉成狗狗語（decode 模式的字串本身已經是「解碼後」的正常文字，不再額外處理） */
  function localize(str) {
    return lang === "dog" ? toDogSpeak(str) : str;
  }

  /** 依目前語言，決定這個關卡實際要顯示的題目文字 */
  function getDisplayPrompt(lv) {
    if (lang === "decode" && lv.decodedPrompt) return lv.decodedPrompt;
    return lv.prompt;
  }

  /** 正規化答案：忽略大小寫、全形/半形空白、前後空白 */
  function normalize(str) {
    return String(str)
      .trim()
      .toLowerCase()
      .replace(/[\u3000\s]+/g, "");
  }

  function isCorrect(levelConfig, userInput) {
    const normalizedInput = normalize(userInput);
    return levelConfig.answers.some(
      (ans) => normalize(ans) === normalizedInput
    );
  }

  /** ---- 進度儲存（存在賓客自己手機的 localStorage，彼此互不干擾） ---- */
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveProgress(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage 不可用（例如無痕模式），遊戲仍可玩，只是重整會重來
      console.warn("無法儲存進度：", e);
    }
  }

  function resetProgress() {
    localStorage.removeItem(STORAGE_KEY);
  }

  /** ---- 狀態初始化 ---- */
  const levels = GAME_CONFIG.levels;
  let state = loadProgress() || {
    currentIndex: 0,
    startedAt: Date.now(),
    hintsUsed: [],
    finished: false,
  };

  // DOM 參照
  const el = {
    intro: document.getElementById("intro-screen"),
    game: document.getElementById("game-screen"),
    result: document.getElementById("result-screen"),
    settings: document.getElementById("setting-screen"),
    settingsToggleBtn: document.getElementById("settings-toggle-btn"),
    returnBtn: document.getElementById("return-btn"),
    settingsResetBtn: document.getElementById("settings-reset-btn"),
    settingsMenuTitle: document.querySelector("#setting-screen .menu"),
    settingsLabel: document.querySelector("#setting-screen .settings-label"),
    langZhBtn: document.getElementById("lang-zh-btn"),
    langDogBtn: document.getElementById("lang-dog-btn"),
    langDecodeBtn: document.getElementById("lang-decode-btn"),
    startBtn: document.getElementById("start-btn"),
    restartBtn: document.getElementById("restart-btn"),
    coupleNames: document.querySelectorAll(".couple-names"),
    introText: document.getElementById("intro-text"),
    levelTitle: document.getElementById("level-title"),
    levelImage: document.getElementById("level-image"),
    levelPrompt: document.getElementById("level-prompt"),
    answerInput: document.getElementById("answer-input"),
    matchContainer: document.getElementById("match-container"),
    submitBtn: document.getElementById("submit-btn"),
    feedback: document.getElementById("feedback"),
    hintBtn: document.getElementById("hint-btn"),
    timer: document.getElementById("timer"),
    seals: document.getElementById("seals"),
    finalTitle: document.getElementById("final-title"),
    finalMessage: document.getElementById("final-message"),
    finalTime: document.getElementById("final-time"),
    dialogueOverlay: document.getElementById("dialogue-overlay"),
    dialogueAvatar: document.getElementById("dialogue-avatar"),
    dialogueName: document.getElementById("dialogue-name"),
    dialogueText: document.getElementById("dialogue-text"),
    dialogueNextBtn: document.getElementById("dialogue-next-btn"),
  };

  /** ---- 2D 對話框系統 ----
   * 開場故事、關卡開場白、提示，都會透過 showDialogue() 進入「對話模式」；
   * 解謎輸入本身完全不受影響，維持一般互動。
   */
  const DLG = GAME_CONFIG.dialogue || {};
  let dialogueQueue = [];
  let dialogueOnComplete = null;
  let typeTimer = null;
  let mouthTimer = null;
  let pendingFullText = "";

  function setAvatar(talking) {
    if (!DLG.talkImage) return;
    if (DLG.idleImage) {
      el.dialogueAvatar.src = talking ? DLG.talkImage : DLG.idleImage;
    } else {
      // 只有一張頭像時，全程顯示同一張，不做嘴巴開合動畫
      el.dialogueAvatar.src = DLG.talkImage;
    }
  }

  function typeText(text) {
    clearInterval(typeTimer);
    clearInterval(mouthTimer);
    pendingFullText = text;
    el.dialogueText.textContent = "";
    setAvatar(true);

    if (DLG.idleImage) {
      let mouthOpen = true;
      mouthTimer = setInterval(() => {
        mouthOpen = !mouthOpen;
        setAvatar(mouthOpen);
      }, 220);
    }

    let i = 0;
    typeTimer = setInterval(() => {
      i += 1;
      el.dialogueText.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(typeTimer);
        clearInterval(mouthTimer);
        typeTimer = null;
        setAvatar(false);
      }
    }, 32);
  }

  function advanceDialogue() {
    if (dialogueQueue.length === 0) {
      el.dialogueOverlay.hidden = true;
      const cb = dialogueOnComplete;
      dialogueOnComplete = null;
      if (cb) cb();
      return;
    }
    const line = dialogueQueue.shift();
    typeText(localize(line));
  }

  /** 開啟對話模式，依序播放 lines；全部播完後呼叫 onComplete（若有） */
  function showDialogue(lines, { onComplete } = {}) {
    if (!lines || lines.length === 0) {
      if (onComplete) onComplete();
      return;
    }
    el.dialogueName.textContent = localize(DLG.speakerName || "");
    dialogueQueue = lines.slice();
    dialogueOnComplete = onComplete || null;
    el.dialogueOverlay.hidden = false;
    advanceDialogue();
  }

  el.dialogueNextBtn.addEventListener("click", () => {
    if (typeTimer) {
      // 還在打字：立刻顯示完整這一句
      clearInterval(typeTimer);
      clearInterval(mouthTimer);
      typeTimer = null;
      el.dialogueText.textContent = pendingFullText;
      setAvatar(false);
    } else {
      advanceDialogue();
    }
  });

  function formatElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const sec = String(totalSec % 60).padStart(2, "0");
    return `${min}:${sec}`;
  }

  function renderSeals() {
    el.seals.innerHTML = "";
    levels.forEach((lv, i) => {
      const dot = document.createElement("span");
      dot.className = "seal" + (i < state.currentIndex ? " sealed" : "");
      dot.title = lv.title;
      el.seals.appendChild(dot);
    });
  }

  /** 建立第六關這種「配對題」用的下拉選單 */
  function renderMatchInputs(lv) {
    el.matchContainer.innerHTML = "";
    const options = lv.matchOptions || [];
    const count = (lv.matchAnswers && lv.matchAnswers.length) || options.length;

    for (let i = 0; i < count; i += 1) {
      const item = document.createElement("div");
      item.className = "match-item";

      const label = document.createElement("span");
      label.className = "match-item-label";
      label.textContent = `${i + 1}`;

      const select = document.createElement("select");
      select.dataset.matchIndex = String(i);

      const placeholderOpt = document.createElement("option");
      placeholderOpt.value = "";
      placeholderOpt.textContent = localize(UI_STRINGS.matchPlaceholder);
      select.appendChild(placeholderOpt);

      options.forEach((opt) => {
        const optionEl = document.createElement("option");
        optionEl.value = opt;
        optionEl.textContent = localize(opt);
        select.appendChild(optionEl);
      });

      item.appendChild(label);
      item.appendChild(select);
      el.matchContainer.appendChild(item);
    }
  }

  /** 實際把這一關的題目內容（標題已提前設定）填進畫面，這一步不牽涉對話框 */
  function renderLevelContent() {
    const lv = levels[state.currentIndex];
    el.levelPrompt.textContent = localize(getDisplayPrompt(lv));

    if (lv.image) {
      el.levelImage.src = lv.image;
      el.levelImage.alt = localize(lv.title);
      el.levelImage.hidden = false;
    } else {
      el.levelImage.hidden = true;
      el.levelImage.removeAttribute("src");
    }

    if (lv.type === "match") {
      el.answerInput.hidden = true;
      el.matchContainer.hidden = false;
      renderMatchInputs(lv);
    } else {
      el.answerInput.hidden = false;
      el.matchContainer.hidden = true;
      el.matchContainer.innerHTML = "";
    }

    el.answerInput.focus();
  }

  /** 進入一個新關卡：先清空畫面，若這關有 intro 對話就先播，播完才顯示題目 */
  function enterLevel() {
    const lv = levels[state.currentIndex];
    el.levelTitle.textContent = localize(lv.title);
    el.levelPrompt.textContent = "";
    el.levelImage.hidden = true;
    el.levelImage.removeAttribute("src");
    el.answerInput.value = "";
    el.matchContainer.hidden = true;
    el.matchContainer.innerHTML = "";
    el.feedback.textContent = "";
    el.feedback.className = "feedback";
    renderSeals();

    if (lv.intro) {
      showDialogue([lv.intro], { onComplete: () => renderLevelContent() });
    } else {
      renderLevelContent();
    }
  }

  let lastScreen = "intro";

  function getCurrentScreenName() {
    if (!el.intro.hidden) return "intro";
    if (!el.game.hidden) return "game";
    if (!el.result.hidden) return "result";
    return "intro";
  }

  function showScreen(name) {
    el.intro.hidden = name !== "intro";
    el.game.hidden = name !== "game";
    el.result.hidden = name !== "result";
    el.settings.hidden = name !== "settings";
    // 齒輪按鈕在設置畫面裡不需要再顯示一次
    el.settingsToggleBtn.hidden = name === "settings";
  }

  function finishGame() {
    state.finished = true;
    saveProgress(state);
    const elapsed = Date.now() - state.startedAt;
    el.finalTitle.textContent = localize(GAME_CONFIG.finalTitle);
    el.finalMessage.textContent = localize(GAME_CONFIG.finalMessage);
    el.finalTime.textContent = localize(`你們總共花了 ${formatElapsed(elapsed)}`);
    showScreen("result");
  }

  /** 配對題（第六關）答案檢查：每一格都要選對 */
  function isMatchCorrect(lv) {
    const selects = el.matchContainer.querySelectorAll("select");
    const answers = lv.matchAnswers || [];
    if (selects.length !== answers.length) return false;
    for (let i = 0; i < selects.length; i += 1) {
      if (normalize(selects[i].value) !== normalize(answers[i])) return false;
    }
    return true;
  }

  function handleSubmit() {
    const lv = levels[state.currentIndex];
    let correct = false;

    if (lv.type === "match") {
      correct = isMatchCorrect(lv);
      if (!correct) {
        const selects = el.matchContainer.querySelectorAll("select");
        const allChosen = Array.from(selects).every((s) => s.value !== "");
        if (!allChosen) return; // 還沒選完，先不判定
      }
    } else {
      const val = el.answerInput.value;
      if (!val.trim()) return;
      correct = isCorrect(lv, val);
    }

    if (correct) {
      el.feedback.textContent = localize(UI_STRINGS.feedbackCorrect);
      el.feedback.className = "feedback correct";
      state.currentIndex += 1;
      saveProgress(state);

      setTimeout(() => {
        if (state.currentIndex >= levels.length) {
          finishGame();
        } else {
          enterLevel();
        }
      }, 700);
    } else {
      el.feedback.textContent = localize(UI_STRINGS.feedbackWrong);
      el.feedback.className = "feedback wrong";
      el.game.classList.remove("shake");
      // 觸發重新播放 shake 動畫
      void el.game.offsetWidth;
      el.game.classList.add("shake");
    }
  }

  function tickTimer() {
    if (state.finished) return;
    el.timer.textContent = formatElapsed(Date.now() - state.startedAt);
  }

  /** ---- 事件綁定 ---- */
  el.startBtn.addEventListener("click", () => {
    if (!state.startedAt || state.currentIndex === 0) {
      state.startedAt = Date.now();
      saveProgress(state);
    }
    showScreen("game");
    showDialogue(DLG.intro, {
      onComplete: () => enterLevel(),
    });
  });

  el.submitBtn.addEventListener("click", handleSubmit);
  el.answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });

  el.hintBtn.addEventListener("click", () => {
    const lv = levels[state.currentIndex];
    if (!state.hintsUsed.includes(lv.id)) {
      state.hintsUsed.push(lv.id);
      saveProgress(state);
    }
    showDialogue([lv.hint || ""]);
  });

  el.restartBtn.addEventListener("click", () => {
    resetProgress();
    state = { currentIndex: 0, startedAt: Date.now(), hintsUsed: [], finished: false };
    showScreen("intro");
  });

  /** ---- 設置畫面：打開／返回／切換語言／重設 ---- */
  el.settingsToggleBtn.addEventListener("click", () => {
    lastScreen = getCurrentScreenName();
    showScreen("settings");
  });

  el.returnBtn.addEventListener("click", () => {
    showScreen(lastScreen);
  });

  function setLang(newLang) {
    lang = newLang;
    saveLang(lang);
    refreshAllTexts();
  }

  el.langZhBtn.addEventListener("click", () => setLang("zh"));
  el.langDogBtn.addEventListener("click", () => setLang("dog"));
  el.langDecodeBtn.addEventListener("click", () => setLang("decode"));

  el.settingsResetBtn.addEventListener("click", () => {
    if (!window.confirm(localize(UI_STRINGS.resetConfirm))) return;
    resetProgress();
    state = { currentIndex: 0, startedAt: Date.now(), hintsUsed: [], finished: false };
    showScreen("intro");
  });

  /** 套用所有「固定不變」的介面文字（按鈕、標題等，不含關卡內容） */
  function applyStaticLabels() {
    document.title = localize(GAME_CONFIG.eventTitle);

    if (GAME_CONFIG.coupleNames) {
      el.coupleNames.forEach((n) => {
        n.hidden = false;
        n.textContent = localize(GAME_CONFIG.coupleNames);
      });
    } else {
      el.coupleNames.forEach((n) => (n.hidden = true));
    }

    el.startBtn.textContent = localize(UI_STRINGS.startBtn);
    el.submitBtn.textContent = localize(UI_STRINGS.submitBtn);
    el.hintBtn.textContent = localize(UI_STRINGS.hintBtn);
    el.restartBtn.textContent = localize(UI_STRINGS.restartBtn);
    el.answerInput.placeholder = localize(UI_STRINGS.answerPlaceholder);
    el.settingsMenuTitle.textContent = localize(UI_STRINGS.settingsTitle);
    el.returnBtn.textContent = localize(UI_STRINGS.returnBtn);
    el.settingsResetBtn.textContent = localize(UI_STRINGS.resetBtn);

    el.langZhBtn.textContent = localize(UI_STRINGS.langNameZh);
    el.langDogBtn.textContent = localize(UI_STRINGS.langNameDog);
    el.langDecodeBtn.textContent = localize(UI_STRINGS.langNameDecode);
    el.langZhBtn.classList.toggle("active", lang === "zh");
    el.langDogBtn.classList.toggle("active", lang === "dog");
    el.langDecodeBtn.classList.toggle("active", lang === "decode");
  }

  /** 語言切換時，重新渲染目前畫面上實際看得到／看不到的內容 */
  function refreshAllTexts() {
    applyStaticLabels();
    el.introText.textContent = localize(GAME_CONFIG.introText);

    if (state.currentIndex < levels.length) {
      const lv = levels[state.currentIndex];
      el.levelTitle.textContent = localize(lv.title);
      // 對話框開著的時候先不動題目內容，避免跟正在播放的對話互相干擾
      if (el.dialogueOverlay.hidden) {
        el.levelPrompt.textContent = localize(getDisplayPrompt(lv));
      }
      if (lv.image) {
        el.levelImage.alt = localize(lv.title);
      }
      if (lv.type === "match" && !el.matchContainer.hidden) {
        renderMatchInputs(lv);
      }
    }

    if (state.finished) {
      const elapsed = Date.now() - state.startedAt;
      el.finalTitle.textContent = localize(GAME_CONFIG.finalTitle);
      el.finalMessage.textContent = localize(GAME_CONFIG.finalMessage);
      el.finalTime.textContent = localize(`你們總共花了 ${formatElapsed(elapsed)}`);
    }
  }

  /** ---- 初始化畫面內容 ---- */
  function init() {
    applyStaticLabels();
    el.introText.textContent = localize(GAME_CONFIG.introText);

    if (state.finished) {
      finishGame();
    } else if (state.currentIndex > 0 && state.currentIndex < levels.length) {
      // 賓客中途重新整理頁面，接續進度（不重播這關的開場白，直接看題目）
      showScreen("game");
      const lv = levels[state.currentIndex];
      el.levelTitle.textContent = localize(lv.title);
      renderSeals();
      renderLevelContent();
    } else {
      showScreen("intro");
    }

    setInterval(tickTimer, 1000);
    tickTimer();
  }

  init();
})();
