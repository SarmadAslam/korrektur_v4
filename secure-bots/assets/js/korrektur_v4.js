document.addEventListener("DOMContentLoaded", function () {
  if (window.innerWidth < 400) {
    const langLegendDiv = document.querySelector(".lang-legend-div");
    const topHeadingsDiv = document.querySelector(".top-headings-div");
    const showSavedBtn = document.querySelector("#showSavedResponsesBtn");

    if (langLegendDiv && topHeadingsDiv && showSavedBtn) {
      topHeadingsDiv.insertBefore(langLegendDiv, showSavedBtn);
    }
  }
});

function lottieLoadAnimation() {
  lottie.loadAnimation({
    container: document.getElementById("gif"),
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "https://login.skrivsikkert.dk/wp-content/uploads/2025/06/robot-wave.json",
  });
}
lottieLoadAnimation();

function lottieLoadAnimationByAddress(div) {
  lottie.loadAnimation({
    container: div,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "https://login.skrivsikkert.dk/wp-content/uploads/2025/06/robot-wave.json",
  });
}

let activeMember = true;
function checkUserMembership() {
  return fetch(
    SB_ajax_object.ajax_url +
      "?action=login_check_user_membership&nonce=" +
      SB_ajax_object.nonce
  )
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        return data.data.has_active_membership;
      } else {
        console.error("Failed to check membership");
        return false;
      }
    })
    .catch((error) => {
      console.error("Error:", error);
      return false;
    });
}

// Run on page load
window.addEventListener("load", function () {
  checkUserMembership().then((hasActiveMembership) => {
    if (hasActiveMembership) {
      console.log("User has active membership");
      // Your code for active members
      activeMember = true;
    } else {
      console.log("User does not have active membership");
      // Your code for non-members or inactive members
      activeMember = false;
    }
    updateGenerateButtonState();
  });
});

// ========================= Global Variables =============================
let currentLanguage = "da";
let toggleState = true;
let cookieToggleState = false;
let originalContent = {};
let correctedText;
let noOfChanges = -1;
let lastCorrectedText = "";
let previousText = "";
let isUndo = false;
let isTilpas = false;
let isMainSwtich = true;
let switcherText = "";
let improvedText = "";
let diffHTMLExp;
let isSmartCalled = false;
let isExplanations = false;
let correctedResults = [];
let diffHTMLParts = [];
let isImproved;
// ================================= Quill editor ====================================
// * ------------------------------- Table fix  ----------------------------- *
Quill.register(
  {
    // note: module name is "table-better", not "better-table"
    "modules/table-better": QuillTableBetter,
  },
  /* overwrite = */ true
);
// * ------------------------------- MS word bullets ----------------------------- *
const Delta = Quill.import("delta");

const LIST_PREFIX_RE = /^(\s*)([\u2022\u00B7•]|[0-9]+[.)]|[A-Za-z]+[.)])\s+/;
//  group 1  ───┘          optional leading spaces / tabs coming from Word
//  group 2                 •  •  •  OR "1." "1)"  OR "A." "a)" …
//  "\s+"                   at least one space / tab after the prefix

function matchMsWordList(node, delta) {
  // clone ops so we never mutate Quill's original Delta
  const ops = delta.ops.map((op) => ({ ...op }));

  // ── 1. find the first text op that actually contains content
  const firstText = ops.find(
    (op) => typeof op.insert === "string" && op.insert.trim().length
  );
  if (!firstText) return delta; // nothing to do

  // ── 2. detect & strip the Word prefix
  const m = firstText.insert.match(LIST_PREFIX_RE);
  if (!m) return delta; // no bullet/number detected

  const fullPrefix = m[0]; // e.g. "1. " (with trailing space)
  const prefixCore = m[2]; // e.g. "1."   (used below)
  firstText.insert = firstText.insert.slice(fullPrefix.length);

  // ── 3. drop the trailing hard-return Word adds at the end of the paragraph
  const last = ops[ops.length - 1];
  if (typeof last.insert === "string" && last.insert.endsWith("\n")) {
    last.insert = last.insert.slice(0, -1);
  }

  // ── 4. decide list type
  const listType = /^\d/.test(prefixCore) ? "ordered" : "bullet";

  // ── 5. indent level (Word exports it in inline CSS: style="level3 …")
  let indent = 0;
  const style = (node.getAttribute("style") || "").replace(/\s+/g, "");
  const levelMatch = style.match(/level(\d+)/); // level1 → indent 0, level2 → indent 1 …
  if (levelMatch) indent = parseInt(levelMatch[1], 10) - 1;

  // ── 6. append Quill's own list marker
  ops.push({ insert: "\n", attributes: { list: listType, indent } });

  return new Delta(ops);
}

// Same helper for bullet paragraphs that come through <p class="MsoNormal"> …
function maybeMatchMsWordList(node, delta) {
  // Word's bullet glyphs are usually "•" U+2022 or "·" U+00B7
  const ch = delta.ops[0].insert.trimLeft()[0];
  if (ch === "•" || ch === "·") {
    return matchMsWordList(node, delta);
  }
  // also catch "1. " or "a) " in plain MsoNormal paragraphs:
  if (/^[0-9A-Za-z][.)]/.test(delta.ops[0].insert)) {
    return matchMsWordList(node, delta);
  }
  return delta;
}
// -------------------- register the improved matchers --------------------
const MSWORD_MATCHERS = [
  ["p.MsoListParagraphCxSpFirst", matchMsWordList],
  ["p.MsoListParagraphCxSpMiddle", matchMsWordList],
  ["p.MsoListParagraphCxSpLast", matchMsWordList],
  ["p.MsoListParagraph", matchMsWordList],
  ["p.msolistparagraph", matchMsWordList],
  ["p.MsoNormal", maybeMatchMsWordList],
];

/* ------------------------------------------------------------------ 1  Create the blots */
const Inline = Quill.import("blots/inline");

class GrammarAdded extends Inline {
  static blotName = "grammar-added";
  static tagName = "ham-dan"; // ← custom element **with a dash**
  static className = "grammar-correction-added";
}

class GrammarRemoved extends Inline {
  static blotName = "grammar-removed";
  static tagName = "ham-dan";
  static className = "grammar-correction-removed";
}

class GrammarPunct extends Inline {
  static blotName = "grammar-punct";
  static tagName = "ham-dan";
  static className = "grammar-correction-punctuation";
}

/* ------------------------------------------------------------------ 2  Register explicitly */
Quill.register(
  {
    "formats/grammar-added": GrammarAdded,
    "formats/grammar-removed": GrammarRemoved,
    "formats/grammar-punct": GrammarPunct,
  },
  true
);

/* ------------------------------------------------------------------ 1  Blot */

class MarkBlot extends Inline {
  static blotName = "mark"; // format key, e.g. { mark: true }
  static tagName = "mark"; // real DOM element <mark>
  static className = "word-highlight"; // optional CSS hook
}

/* ------------------------------------------------------------------ 2  Register */
Quill.register({ "formats/mark": MarkBlot }, /*suppressWarning=*/ true);

const quill1 = new Quill("#inputText", {
  theme: "snow",
  modules: {
    // --- CORRECTED PART ---
    // Instead of 'toolbar: false', provide an empty array to ensure
    // the toolbar module is loaded, which quill-table-better depends on.
    toolbar: [],

    clipboard: {
      matchVisual: false,
      matchers: MSWORD_MATCHERS,
    },
    // disable the built-in table if you had it on
    table: false,

    // turn on the enhanced table
    "table-better": {
      // your options here (you can leave empty for defaults)
      operationMenu: {
        items: {
          unmergeCells: {
            text: "Unmerge cells",
          },
        },
      },
    },

    // wire up the keyboard nav that the plugin provides
    keyboard: {
      bindings: QuillTableBetter.keyboardBindings,
    },
    // Note: The 'matchVisual: false' key was duplicated, I have removed it from here.
    // It correctly belongs inside the 'clipboard' options.
  },
  placeholder:
    "Skriv eller indtal din tekst for at rette grammatikken på dansk…",
});


const clearButton = document.querySelector("#clearBtn");
const revertFun = document.querySelector("#revertBack");
const forwardFun = document.querySelector("#forwardButton");

const mainTextAreaToggle = document.querySelector(".main-textarea-section");
const correctionSidebar = document.querySelector(".correction-sidebar");
const isMobileToggle = window.innerWidth <= 767;
const isMobile =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
const isFirefox = navigator.userAgent.toLowerCase().indexOf("firefox") > -1;
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const needsScrollHandling = isMobile || isSafari;



// Log initialization status
console.log("Initializing undo/redo buttons...");
console.log("revertFun (undo button):", revertFun ? "Found" : "Not found");
console.log("forwardFun (redo button):", forwardFun ? "Found" : "Not found");
console.log("clearButton:", clearButton ? "Found" : "Not found");
console.log("quill1:", quill1 ? "Quill editor initialized" : "Quill editor not initialized");
console.log("quill1.history:", quill1 && quill1.history ? "History module available" : "History module not available");



// ========================================== Revert back (undo) btn ===============================================
if (revertFun) {
  revertFun.addEventListener("click", (e) => {
    e.preventDefault();
    console.log("Undo button clicked");
    try {
      if (quill1 && quill1.history) {
        quill1.history.undo();
        console.log("Undo action performed. Undo stack:", quill1.history.stack.undo.length, "Redo stack:", quill1.history.stack.redo.length);
        updateClearRevertButtonState(); // <-- Added to update button states after undo
      } else {
        console.error("Undo failed: quill1 or quill1.history is undefined");
      }
    } catch (error) {
      console.error("Error during undo:", error);
    }
  });
} else {
  console.error("Undo button (#revertBack) not found in DOM");
}

// ========================================== Forward (redo) btn ===============================================
if (forwardFun) {
  forwardFun.addEventListener("click", (e) => {
    e.preventDefault();
    console.log("Redo button clicked");
    try {
      if (quill1 && quill1.history) {
        quill1.history.redo();
        console.log("Redo action performed. Undo stack:", quill1.history.stack.undo.length, "Redo stack:", quill1.history.stack.redo.length);
        updateClearRevertButtonState(); // <-- Added to update button states after redo
      } else {
        console.error("Redo failed: quill1 or quill1.history is undefined");
      }
    } catch (error) {
      console.error("Error during redo:", error);
    }
  });
} else {
  console.error("Redo button (#forwardButton) not found in DOM");
}



/* ------------------------------------------------------------------ 4  Clipboard matchers */
function mark(attr) {
  return (node, delta) => {
    delta.ops.forEach((op) => {
      op.attributes = { ...(op.attributes || {}), [attr]: true };
    });
    return delta;
  };
}

quill1.clipboard.addMatcher(
  "ham-dan.grammar-correction-added",
  mark("grammar-added")
);
quill1.clipboard.addMatcher(
  "ham-dan.grammar-correction-removed",
  mark("grammar-removed")
);
quill1.clipboard.addMatcher(
  "ham-dan.grammar-correction-punctuation",
  mark("grammar-punct")
);

function flag(attr) {
  return (node, delta) => {
    delta.ops.forEach((op) => {
      op.attributes = { ...(op.attributes || {}), [attr]: true };
    });
    return delta;
  };
}

// keep pasted <mark> highlights
quill1.clipboard.addMatcher("mark.word-highlight", flag("mark"));

// ================================= Fixed Quill editor ====================================

// Event handlers
quill1.on("text-change", function (delta, oldDelta, source) {
  adjustHeights();
});

function updatePlaceholder(lang) {
  if (quill1) {
    const placeholderText = `Skriv eller indtal din tekst for at rette grammatikken på ${lang.toLowerCase()}...`;
    quill1.root.setAttribute("data-placeholder", placeholderText);
  } else {
    console.error("Quill editor not initialized.");
  }
}

// ============================== Global Document ==============================
const mainSwitcher = document.getElementById("mainSwitcher");
// =============================== Language Dropdown ==============================

const languageMap = {
  Dansk: "da",
  Engelsk: "en",
  Tysk: "ge",
  Fransk: "fr",
  Spansk: "es",
};
function getLanguageName(langCode) {
  const languageName = Object.entries(languageMap).find(
    ([key, value]) => value === langCode
  )?.[0];
  return languageName;
}
function closeAllDropdowns() {
  document.querySelectorAll(".dk-dropdown").forEach((dropdown) => {
    dropdown.classList.remove("dk-show");
  });
  document.querySelectorAll(".dk-language-select").forEach((select) => {
    select.classList.remove("dk-active");
  });
}

function updateDropdownOptions() {
  updatePlaceholder(getLanguageName(currentLanguage));
}

function handleCustomLanguage(input, languageSelect) {
  const customLanguage = input.value.trim();
  if (!customLanguage) return;

  const languageText = languageSelect.querySelector(".dk-language-text");
  languageText.textContent = customLanguage;
  currentLanguage = languageMap[customLanguage] || customLanguage;
  // //// console.log("currentLanguage", currentLanguage)
  input.value = "";
  closeAllDropdowns();
  updateDropdownOptions();
}

document.addEventListener("click", function (e) {
  const customInput = e.target.closest(".dk-custom-input");
  if (!customInput) {
    const openDropdown = document.querySelector(".dk-dropdown.dk-show");
    if (openDropdown) {
      const input = openDropdown.querySelector(".dk-custom-input");
      if (input && input.value.trim()) {
        handleCustomLanguage(
          input,
          openDropdown.closest(".dk-language-select")
        );
      }
    }
    if (!e.target.closest(".dk-language-select")) {
      closeAllDropdowns();
    }
  }
});

document.querySelectorAll(".dk-language-select").forEach((select) => {
  select.addEventListener("click", function (e) {
    if (e.target.closest(".dk-custom-input")) return;
    e.stopPropagation();
    const dropdown = this.querySelector(".dk-dropdown");
    const isOpen = dropdown.classList.contains("dk-show");
    closeAllDropdowns();
    if (!isOpen) {
      dropdown.classList.add("dk-show");
      this.classList.add("dk-active");
    }
  });

  const customInput = select.querySelector(".dk-custom-input");
  if (customInput) {
    customInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCustomLanguage(customInput, select);
      }
    });
    customInput.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }
});

document.querySelectorAll(".dk-dropdown-item").forEach((item) => {
  item.addEventListener("click", function (e) {
    e.stopPropagation();
    if (this.classList.contains("dk-disabled")) return;

    const languageSelect = this.closest(".dk-language-select");
    const languageText = languageSelect.querySelector(".dk-language-text");
    const selectedLang = this.getAttribute("data-lang");

    languageText.textContent = selectedLang;
    currentLanguage = languageMap[selectedLang] || selectedLang;
    // //// console.log("currentLanguage", currentLanguage);
    updateDropdownOptions();
    closeAllDropdowns();
  });
});

// ================================ toggle code =====================================
document.getElementById("correction-toggle").addEventListener("change", (e) => {
  if (e.target.checked) {
    toggleState = true;
  } else {
    toggleState = false;
  }

  //console.log(toggleState);
  if (toggleState !== cookieToggleState) {
    setCookie("korrektur-toggle", toggleState, 30); // Save for 30 days
  }
  actionOnToggle(toggleState);
});

// -------------- cookies code for saving the value of the toggle previous --------------
const getCookie = (name) => {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? match[2] : null;
};

const setCookie = (name, value, days) => {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie =
    name + "=" + value + ";expires=" + expires.toUTCString() + ";path=/";
};

document.addEventListener("DOMContentLoaded", () => {
  if (window.innerWidth < 450) {
    toggleState = true;
    console.log("it is called");
  } else {
    if (getCookie("korrektur-toggle") === null) {
      setCookie("korrektur-toggle", true, 30);
    }
    cookieToggleState = getCookie("korrektur-toggle") === "true";
    toggleState = cookieToggleState;
  }
  actionOnToggle(toggleState);
});

function actionOnToggle(toggleState) {
  // Set the toggle switch state
  document.getElementById("correction-toggle").checked = toggleState;

  // Show/hide legend dots
  let legendDots = document.querySelector("#legend-section");
  legendDots.style.display = toggleState ? "flex" : "none";


  hideUnderlines(toggleState);
  callSidebar();

  if (!isMobileToggle) {
    if (toggleState) {
      // Expanded state
      mainTextAreaToggle.style.flexBasis = "74%";
      correctionSidebar.classList.remove("collapsed");
      correctionSidebar.style.flexBasis = "25%";
      correctionSidebar.style.maxWidth = "25%";
      correctionSidebar.style.minWidth = "25%";
      correctionSidebar.style.display = "flex";
    } else {
      // Collapsed state (show only icons)
      mainTextAreaToggle.style.flexBasis = "95%";
      correctionSidebar.classList.add("collapsed");
      correctionSidebar.style.flexBasis = "5%";
      correctionSidebar.style.maxWidth = "64px";
      correctionSidebar.style.minWidth = "64px";
      correctionSidebar.style.display = "flex";
    }
  } else {
    // On mobile, always hide sidebar
    mainTextAreaToggle.style.flexBasis = "100%";
    correctionSidebar.style.display = "none";
  }

  adjustInputTextareaHeight();
}

// Sidebar toggle button should perform the same logic as the toolbar switch
const sidebarToggleBtn = document.getElementById("sidebarCollapseBtn");
if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener("click", () => {
    // Toggle the state (invert current toggleState)
    toggleState = !toggleState;

    // If the switch exists, sync its checked state (for robustness)
    const correctionSwitch = document.getElementById("correction-toggle");
    if (correctionSwitch) {
      correctionSwitch.checked = toggleState;
    }

    // Set cookie if changed
    if (toggleState !== cookieToggleState) {
      setCookie("korrektur-toggle", toggleState, 30);
    }

    // Call the main toggle action
    actionOnToggle(toggleState);
  });
}



// --- Sidebar collapse/expand icon and icons row handling ---
// ... existing code ...
document.addEventListener("DOMContentLoaded", () => {
  const sidebarToggleBtn = document.getElementById("sidebarCollapseBtn");
  const sidebar = document.querySelector(".correction-sidebar");
  const sidebarIcons = document.querySelector(".sidebar-collapsed-icons");
  const toggleIconSpan = sidebarToggleBtn ? sidebarToggleBtn.querySelector('.sidebar-toggle-icon') : null;

  // SVGs as strings
  const expandSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="11" viewBox="0 0 10 11" fill="none"><mask id="path-1-inside-1_6151_1083" fill="white"><path d="M1.66634 8.83331H3.66634C3.85523 8.83331 4.01367 8.89731 4.14167 9.02531C4.26967 9.15331 4.33345 9.31154 4.33301 9.49998C4.33256 9.68842 4.26856 9.84687 4.14101 9.97531C4.01345 10.1038 3.85523 10.1675 3.66634 10.1666H0.999674C0.810786 10.1666 0.652563 10.1026 0.525008 9.97465C0.397452 9.84665 0.333452 9.68842 0.333008 9.49998V6.83331C0.333008 6.64442 0.397008 6.4862 0.525008 6.35865C0.653008 6.23109 0.81123 6.16709 0.999674 6.16665C1.18812 6.1662 1.34656 6.2302 1.47501 6.35865C1.60345 6.48709 1.66723 6.64531 1.66634 6.83331V8.83331ZM8.33301 2.16665H6.33301C6.14412 2.16665 5.9859 2.10265 5.85834 1.97465C5.73079 1.84665 5.66679 1.68842 5.66634 1.49998C5.6659 1.31154 5.7299 1.15331 5.85834 1.02531C5.98679 0.897313 6.14501 0.833313 6.33301 0.833313H8.99967C9.18856 0.833313 9.34701 0.897313 9.47501 1.02531C9.60301 1.15331 9.66679 1.31154 9.66634 1.49998V4.16665C9.66634 4.35554 9.60234 4.51398 9.47434 4.64198C9.34634 4.76998 9.18812 4.83376 8.99967 4.83331C8.81123 4.83287 8.65301 4.76887 8.52501 4.64131C8.39701 4.51376 8.33301 4.35554 8.33301 4.16665V2.16665Z"/></mask><path d="M1.66634 8.83331H-0.333659V10.8333H1.66634V8.83331ZM4.33301 9.49998L6.333 9.5047L4.33301 9.49998ZM3.66634 10.1666L3.67575 8.16665H3.66634V10.1666ZM0.333008 9.49998L-1.667 9.49998L-1.66699 9.5047L0.333008 9.49998ZM1.66634 6.83331L-0.333659 6.82386V6.83331H1.66634ZM8.33301 2.16665H10.333V0.166646H8.33301V2.16665ZM9.66634 1.49998L7.66634 1.49526V1.49998H9.66634ZM8.99967 4.83331L8.99496 6.83331L8.99967 4.83331ZM1.66634 8.83331V10.8333H3.66634V8.83331V6.83331H1.66634V8.83331ZM3.66634 8.83331V10.8333C3.53116 10.8333 3.36048 10.8095 3.17779 10.7357C2.9934 10.6613 2.84193 10.554 2.72746 10.4395L4.14167 9.02531L5.55589 7.6111C5.03502 7.09023 4.35996 6.83331 3.66634 6.83331V8.83331ZM4.14167 9.02531L2.72746 10.4395C2.61301 10.3251 2.5053 10.1732 2.43054 9.9877C2.35643 9.80384 2.33269 9.63183 2.33301 9.49526L4.33301 9.49998L6.333 9.5047C6.33464 8.80855 6.077 8.13221 5.55589 7.6111L4.14167 9.02531ZM4.33301 9.49998L2.33301 9.49526C2.33333 9.36062 2.35733 9.19161 2.43024 9.01109C2.50379 8.82901 2.60937 8.67933 2.72189 8.56602L4.14101 9.97531L5.56012 11.3846C6.0752 10.8659 6.33137 10.1955 6.333 9.5047L4.33301 9.49998ZM4.14101 9.97531L2.72189 8.56602C2.83748 8.44963 2.99117 8.3402 3.17895 8.26451C3.36498 8.18952 3.53866 8.16602 3.67575 8.16667L3.66634 10.1666L3.65693 12.1666C4.35587 12.1699 5.03684 11.9115 5.56012 11.3846L4.14101 9.97531ZM3.66634 10.1666V8.16665H0.999674V10.1666V12.1666H3.66634V10.1666ZM0.999674 10.1666V8.16665C1.13482 8.16665 1.30593 8.19041 1.4893 8.26458C1.67444 8.33947 1.82663 8.44745 1.94168 8.56289L0.525008 9.97465L-0.891663 11.3864C-0.370306 11.9096 0.305986 12.1666 0.999674 12.1666V10.1666ZM0.525008 9.97465L1.94168 8.56289C2.05517 8.67679 2.16145 8.82718 2.23541 9.01002C2.3087 9.19122 2.33268 9.36066 2.333 9.49526L0.333008 9.49998L-1.66699 9.5047C-1.66536 10.1956 -1.40903 10.8672 -0.891663 11.3864L0.525008 9.97465ZM0.333008 9.49998H2.33301V6.83331H0.333008H-1.66699V9.49998H0.333008ZM0.333008 6.83331H2.33301C2.33301 6.96846 2.30925 7.13957 2.23507 7.32294C2.16018 7.50808 2.05221 7.66027 1.93676 7.77532L0.525008 6.35865L-0.886744 4.94198C-1.40992 5.46333 -1.66699 6.13963 -1.66699 6.83331H0.333008ZM0.525008 6.35865L1.93676 7.77532C1.82287 7.88881 1.67247 7.99509 1.48963 8.06905C1.30844 8.14234 1.139 8.16632 1.00439 8.16664L0.999674 6.16665L0.994958 4.16665C0.30408 4.16828 -0.367579 4.42461 -0.886744 4.94198L0.525008 6.35865ZM0.999674 6.16665L1.00439 8.16664C0.866919 8.16697 0.694556 8.14297 0.510785 8.06874C0.325538 7.99392 0.174343 7.88641 0.0607942 7.77286L1.47501 6.35865L2.88922 4.94443C2.36911 4.42432 1.69323 4.16501 0.994958 4.16665L0.999674 6.16665ZM1.47501 6.35865L0.0607942 7.77286C-0.052732 7.65933 -0.160685 7.5077 -0.235796 7.32137C-0.310343 7.13643 -0.334293 6.96272 -0.333636 6.82386L1.66634 6.83331L3.66632 6.84277C3.66963 6.14195 3.40957 5.46478 2.88922 4.94443L1.47501 6.35865ZM1.66634 6.83331H-0.333659V8.83331H1.66634H3.66634V6.83331H1.66634ZM8.33301 2.16665V0.166646H6.33301V2.16665V4.16665H8.33301V2.16665ZM6.33301 2.16665V0.166646C6.46815 0.166646 6.63927 0.190409 6.82263 0.26458C7.00778 0.339469 7.15997 0.447449 7.27501 0.562894L5.85834 1.97465L4.44167 3.3864C4.96303 3.90957 5.63932 4.16665 6.33301 4.16665V2.16665ZM5.85834 1.97465L7.27501 0.562894C7.38851 0.676786 7.49478 0.827183 7.56874 1.01002C7.64203 1.19122 7.66602 1.36066 7.66634 1.49526L5.66634 1.49998L3.66635 1.5047C3.66798 2.19557 3.92431 2.86723 4.44167 3.3864L5.85834 1.97465ZM5.66634 1.49998L7.66634 1.49526C7.66666 1.63269 7.64268 1.80549 7.56807 1.98994C7.49284 2.17594 7.38462 2.32786 7.2701 2.44198L5.85834 1.02531L4.44658 -0.391349C3.92417 0.129254 3.6647 0.80635 3.66635 1.5047L5.66634 1.49998ZM5.85834 1.02531L7.2701 2.44198C7.15713 2.55456 7.007 2.66107 6.8233 2.73538C6.64103 2.80911 6.4699 2.83331 6.33301 2.83331V0.833313V-1.16669C5.63749 -1.16669 4.965 -0.907975 4.44658 -0.391349L5.85834 1.02531ZM6.33301 0.833313V2.83331H8.99967V0.833313V-1.16669H6.33301V0.833313ZM8.99967 0.833313V2.83331C8.86449 2.83331 8.69381 2.80954 8.51112 2.73574C8.32673 2.66127 8.17526 2.554 8.06079 2.43953L9.47501 1.02531L10.8892 -0.3889C10.3684 -0.909765 9.69329 -1.16669 8.99967 -1.16669V0.833313ZM9.47501 1.02531L8.06079 2.43953C7.94635 2.32508 7.83863 2.17317 7.76387 1.9877C7.68976 1.80385 7.66602 1.63183 7.66635 1.49526L9.66634 1.49998L11.6663 1.5047C11.668 0.808545 11.4103 0.13221 10.8892 -0.3889L9.47501 1.02531ZM9.66634 1.49998H7.66634V4.16665H9.66634H11.6663V1.49998H9.66634ZM9.66634 4.16665H7.66634C7.66634 4.03146 7.69012 3.86078 7.76391 3.67809C7.83839 3.49371 7.94566 3.34224 8.06013 3.22777L9.47434 4.64198L10.8886 6.05619C11.4094 5.53533 11.6663 4.86026 11.6663 4.16665H9.66634ZM9.47434 4.64198L8.06013 3.22777C8.17458 3.11332 8.32648 3.0056 8.51196 2.93084C8.69581 2.85673 8.86782 2.833 9.00439 2.83332L8.99967 4.83331L8.99496 6.83331C9.6911 6.83495 10.3674 6.57731 10.8886 6.05619L9.47434 4.64198ZM8.99967 4.83331L9.00439 2.83332C9.139 2.83364 9.30844 2.85762 9.48963 2.93091C9.67247 3.00487 9.82287 3.11115 9.93676 3.22464L8.52501 4.64131L7.11326 6.05798C7.63242 6.57535 8.30408 6.83168 8.99496 6.83331L8.99967 4.83331ZM8.52501 4.64131L9.93676 3.22464C10.0522 3.33969 10.1602 3.49188 10.2351 3.67702C10.3092 3.86039 10.333 4.0315 10.333 4.16665H8.33301H6.33301C6.33301 4.86033 6.59008 5.53663 7.11326 6.05798L8.52501 4.64131ZM8.33301 4.16665H10.333V2.16665H8.33301H6.33301V4.16665H8.33301Z" fill="#A0A0A0" mask="url(#path-1-inside-1_6151_1083)"/></svg>`;
  const collapseSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="12" viewBox="0 0 13 12" fill="none"><path d="M1.83301 7.33331H5.16634V10.6666M11.1663 4.66665H7.83301V1.33331" stroke="#A0A0A0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // Helper to update the toggle icon
  function updateToggleIcon(collapsed) {
    if (toggleIconSpan) {
      toggleIconSpan.innerHTML = collapsed ? collapseSVG : expandSVG;
    }
  }

  // Helper to show/hide sidebar icons row
  function updateSidebarIconsDisplay(collapsed) {
    if (sidebarIcons) {
      sidebarIcons.style.display = collapsed ? "none" : "flex";
    }
  }

  // Hide sidebar icons by default on page load
  if (sidebarIcons) {
    sidebarIcons.style.display = "none";
  }

  // Initial state
  if (sidebar && sidebarToggleBtn) {
    const collapsed = sidebar.classList.contains("collapsed");
    updateToggleIcon(collapsed);
    updateSidebarIconsDisplay(collapsed);

    sidebarToggleBtn.addEventListener("click", () => {
      // Toggle collapsed class

      const willBeCollapsed = !sidebar.classList.contains("collapsed");
sidebar.classList.toggle("collapsed", willBeCollapsed);
updateSidebarIconsDisplay(willBeCollapsed);

      // Update icon and icons row
      updateToggleIcon(willBeCollapsed);
    });
  }
});
// ... existing code ...

function hideUnderlines(flag) {
  //console.log("in the hideUnderlines value of flag", flag);
  const textContainer = document.getElementById("inputText");
  if (!textContainer) return;

  const spans = textContainer.querySelectorAll(
    "ham-dan.grammar-correction-added, ham-dan.grammar-correction-removed, ham-dan.grammar-correction-punctuation"
  );
  //console.log("Filtered spans:", spans);

  spans.forEach((span) => {
    if (!flag) {
      //console.log("Hiding underlines and removed words");
      span.style.borderBottom = "none";
      if (span.classList.contains("grammar-correction-removed")) {
        span.style.display = "none";
      }
    } else {
      //console.log("Showing underlines and removed words");
      span.style.borderBottom = "2px solid";
      if (span.classList.contains("grammar-correction-added")) {
        span.style.borderColor = "#1768FE";
      } else if (span.classList.contains("grammar-correction-removed")) {
        span.style.display = "inline";
        span.style.borderColor = "#C00F0C";
      } else if (span.classList.contains("grammar-correction-punctuation")) {
        span.style.borderColor = "#E5A000";
      }
    }
  });

  adjustInputTextareaHeight();
}

// ------------------------correction tab switching-------------------------

const dropdownButton = document.querySelector(".hk-dropdown-button");
const dropdownContent = document.querySelector(".hk-dropdown-content");
const dropdownOptions = document.querySelectorAll(".hk-dropdown-option");
const correctionInner = document.querySelector(".correction-inner");
const styleInner = document.querySelector(".style-inner");
const improvInner = document.querySelector(".improv-inner");
const toneInner = document.querySelector(".tone-inner")

// Function to update selected option
function updateSelectedOption(option) {
  const selectedIcon = dropdownButton.querySelector("svg:first-child");
  const selectedText = dropdownButton.querySelector(".hk-dropdown-text");
  const optionIcon = option.querySelector("svg").cloneNode(true);
  const optionText = option.querySelector("span").textContent;
  //console.log("updateSelectedOption", option);
  // Update icon and text
  selectedIcon.replaceWith(optionIcon);
  selectedText.textContent = optionText;

  // Update active states
  dropdownOptions.forEach((opt) => opt.classList.remove("active"));
  option.classList.add("active");

  if (option.dataset.option === "smart-help") {
    improvInner.style.display = "none";
    correctionInner.style.display = "flex";
    styleInner.style.display = "none";
    toneInner.style.display = "none"
    optionIcon.querySelectorAll("path").forEach((path) => {
      if (path.getAttribute("stroke") === "#929292") {
        path.setAttribute("stroke", "#E24668");
      }
    });
    const gifInsider = document.querySelector(
      ".correction-inner .demo-inner #gif"
    );
    if (gifInsider && !gifInsider.querySelector("svg")) {
      lottieLoadAnimationByAddress(gifInsider);
    }
    console.log("inside the smart-help", gifInsider);
  } else if (option.dataset.option === "change-style") {
    improvInner.style.display = "none";
    correctionInner.style.display = "none";
    toneInner.style.display = "none";
    styleInner.style.display = "flex";
    optionIcon.querySelectorAll("path").forEach((path) => {
      path.setAttribute("stroke", "#E24668");
    });
  } else if (option.dataset.option === "improve-text") {
    improvInner.style.display = "flex";
    correctionInner.style.display = "none";
    styleInner.style.display = "none";
    toneInner.style.display = "none";
    optionIcon.querySelectorAll("path, line, polyline").forEach((element) => {
      element.setAttribute("stroke", "#E24668");
    });
  } else if (option.dataset.option === "tone-style") {
    improvInner.style.display = "none";
    correctionInner.style.display = "none";
    toneInner.style.display = "flex";
    styleInner.style.display = "none";
    optionIcon.querySelectorAll("path").forEach((path) => {
      path.setAttribute("stroke", "#E24668");
    });
  }
  onUpdateSelectOption(option);
  // ! remember to fix this
  // syncContentHeights();
}
// Toggle dropdown
dropdownButton.addEventListener("click", () => {
  const isOpen = dropdownContent.classList.contains("show");
  dropdownContent.classList.toggle("show");
  dropdownButton.classList.toggle("active");
});

// Handle option selection
dropdownOptions.forEach((option) => {
  option.addEventListener("click", () => {
    updateSelectedOption(option);
    dropdownContent.classList.remove("show");
    dropdownButton.classList.remove("active");
  });
});

// Close dropdown when clicking outside
document.addEventListener("click", (event) => {
  if (!dropdownButton.contains(event.target)) {
    dropdownContent.classList.remove("show");
    dropdownButton.classList.remove("active");
  }
});

// Initialize with the first option selected
window.addEventListener("DOMContentLoaded", () => {
  // Set the first option as selected
  updateSelectedOption(dropdownOptions[0]);

  // Ensure improv-inner is visible by default
  const improvInner = document.querySelector(".improv-inner");
  const correctionInner = document.querySelector(".correction-inner");
  const styleInner = document.querySelector(".style-inner");

  improvInner.style.display = "flex";
  correctionInner.style.display = "none";
  styleInner.style.display = "none";
});

// Function to update dropdown based on which panel is shown
function updateDropdownFromPanel(panel) {
  // Find the appropriate option based on which panel is passed
  let targetOption;
  if (panel === correctionInner) {
    targetOption = document.querySelector(
      '.hk-dropdown-option[data-option="smart-help"]'
    );
  } else if (panel === styleInner) {
    targetOption = document.querySelector(
      '.hk-dropdown-option[data-option="change-style"]'
    );
  }

  // If we found a matching option, update the dropdown
  if (targetOption) {
    updateSelectedOption(targetOption);
  }
}
function onUpdateSelectOption(option) {
  if (option.dataset.option === "smart-help") {
    // console.log("in onUpdateSelectOption it is smart-help")
    // console.log("result of lastCorrectedText != ''", lastCorrectedText != '')

    if (lastCorrectedText != "" && isSmartCalled == false) {
      // ✅ Show loaders before calling analyzeTranslatedText
      showLoader(".correction-message", "Analyzing...");
      analyseLoader(true);
      console.log("on update selection analyzeTranslatedText");
      analyzeTranslatedText();
      // console.log("calling in the smart-help")
    } else {
      // ✅ If no API call needed, make sure loaders are hidden
      hideLoader(".correction-message");
      analyseLoader(false);
    }
  } else if (option.dataset.option === "improve-text") {
    // ✅ Show loader if explanations will be processed
    if (noOfChanges > 0 && !isExplanations) {
      showLoader(".correction-message", "Analyzing...");
    }

    callImproveSidebar();
  } else if (option.dataset.option === "change-style") {
    // ✅ Make sure loaders are hidden for style tab
    hideLoader(".correction-message");
    analyseLoader(false);
  }
  clearHighlights();
  adjustHeights();
}
// ----------------------------- Check the sidebar
function callSidebar() {
  if (toggleState && window.innerWidth > 767) {
    const dropDownValue =
      document.querySelector(".hk-dropdown-text").textContent;
    // console.log("dropDownValue", dropDownValue);

    if (dropDownValue === "Grammatik") {
      // ✅ Show loader if explanations will be processed
      if (noOfChanges > 0 && !isExplanations) {
        showLoader(".correction-message", "Analyzing...");
      }
      callImproveSidebar();
    } else if (dropDownValue === "Smart teksthjælp") {
      // console.log("Retter teksten call started");
      // console.log("starting the analysis");

      if (lastCorrectedText != "" && isSmartCalled == false) {
        // ✅ Show loaders before calling analyzeTranslatedText
        showLoader(".correction-message", "Analyzing...");
        analyseLoader(true);
        console.log("call sidebar analyzeTranslatedText");
        analyzeTranslatedText();
      } else {
        // ✅ If no API call needed, make sure loaders are hidden
        // hideLoader('.correction-message');
        // analyseLoader(false);
      }
    }
  }
}

// =================================================== gen button ================================

function callImproveSidebar() {
  if (noOfChanges != -1) {
    if (noOfChanges == 0) {
      hideLoader(".correction-message");
      noChangeResultImproveInner();
      analyseLoader(false);
      return;
    }

    if (noOfChanges > 0 && !isExplanations) {
      // console.log("\n=================================Data sending to the explanation api=============================\n");
      // console.log("user input", originalContent.text);
      // console.log("corrected text", correctedText);
      // console.log("no of changes", noOfChanges);

      // ✅ Only show loader if not already shown
      // (this prevents duplicate loader calls when switching tabs)
      const existingLoader = document.querySelector(".gradient-loader");
      if (!existingLoader) {
        showLoader(".correction-message", "Analyzing...");
      }

      // Check if we have multiple HTML parts (same logic as correction)
      const htmlParts = window.currentHtmlParts || [originalContent.html];

      if (htmlParts.length === 1) {
        // Single part - use existing single API call
        let spanList = collectSpanTags(diffHTMLExp);
        // console.log("Span tag list ", spanList);

        grammerApi("explanations", {
          original: originalContent.text,
          corrected: correctedText,
          noOfChanges: noOfChanges.toString(),
          grammarClasses: JSON.stringify(spanList),
        })
          .then((explanationResults) => {
            isExplanations = true;
            processGrammarExplanations(explanationResults);
            hideLoader(".correction-message");
            analyseLoader(false);
          })
          .catch((error) => {
            console.error("Explanation API Error:", error);
            handleExplanationError();
          });
      } else {
        // Multiple parts - use parallel processing
        // console.log("Processing explanations in parallel for", htmlParts.length, "parts");

        // Prepare parameters for each part
        const explanationParts = prepareExplanationParts(htmlParts);
        // console.log("Pattern Recieving ExplanationParts Sending", explanationParts);

        grammerApiParallel("explanations", explanationParts)
          .then((explanationResults) => {
            // Combine results
            // console.log("explanationResults", explanationResults);
            const combinedExplanations =
              combineExplanationResults(explanationResults);
            // console.log("combinedExplanations", combinedExplanations);
            isExplanations = true;
            processGrammarExplanations(combinedExplanations);
            hideLoader(".correction-message");
            analyseLoader(false);
          })
          .catch((error) => {
            console.error("Parallel Explanation API Error:", error);
            // Fallback to single explanation call
            // fallbackToSingleExplanation();
            handleExplanationError();
          });
      }
    } else {
      // ✅ If explanations already processed, just hide loaders
      hideLoader(".correction-message");
      analyseLoader(false);
    }
  } else {
    // ✅ If no changes processed yet, hide loaders
    hideLoader(".correction-message");
    analyseLoader(false);
  }
}

function updateGenerateButtonState() {
  // Variables used for the elements in the DOM
  let inputText1 = quill1;
  const wordCount = document.querySelector(".word-count");
  const charLimitWarning = document.querySelector(".char-limit-warning");
  const wordCounterDiv = document.querySelector(".word-counter-div");
  const charCount2 = inputText1 ? quill1.getText().trim().length : 0;
  let generateBtn = document.querySelector("#genBtn");
  const counterNav = document.querySelector(".counter-nav-div");

  // Set limits based on membership status
  const charLimit = activeMember ? 20000 : 500;
  const hasText =
    quill1.getText().trim().length > 0 &&
    quill1.getText().trim().length <= charLimit;
  const overlimit = quill1.getText().trim().length > charLimit;

  // Handle layout and styling based on membership
  if (activeMember) {
    // Unlimited version layout and styling
    wordCounterDiv.style.display = overlimit ? "flex" : "none";
    wordCounterDiv.style.flexDirection = "column";
    // counterNav.style.marginTop = '0px';
    // Style the warning message for unlimited
    if (charLimitWarning) {
      // counterNav.style.marginTop = '15px';
      charLimitWarning.style.color = "#606060";
      charLimitWarning.style.fontSize = "14px";
      charLimitWarning.style.marginBottom = "9px";
      charLimitWarning.textContent =
        "Fjern lidt tekst – så hjælper robotten bedre.";
    }

    // Style the word count for unlimited
    if (wordCount) {
      wordCount.style.color = "#606060";
      wordCount.style.fontSize = "14px";
      wordCount.style.marginBottom = "8px";

      const formattedCount = charCount2.toLocaleString("da-DK");
      const overBy = (charCount2 - 20000).toLocaleString("da-DK");
      wordCount.textContent = `${formattedCount}/20.000 tegn (${overBy} over)`;
    }
  } else {
    // Limited version layout and styling
    counterNav.style.marginTop = "15px";
    wordCounterDiv.style.display = "flex";
    wordCounterDiv.style.flexDirection = "row";

    // Style the word count for limited
    if (wordCount) {
      wordCount.style.color = "#606060";
      wordCount.style.fontSize = "14px";
      wordCount.style.marginBottom = "0px";
      wordCounterDiv.style.flexDirection = "row-reverse";
      const formattedCount = charCount2.toLocaleString("da-DK");
      wordCount.textContent = `${formattedCount}/500 tegn`;
    }

    // Style the warning message for limited
    if (charLimitWarning) {
      charLimitWarning.style.display = overlimit ? "inline" : "none";
      charLimitWarning.classList.add("char-limit-warning-limited");
      charLimitWarning.innerHTML = `&nbsp;• <a class="char-limit-warning-red" href="https://login.skrivsikkert.dk/konto/" target="_blank">Opgrader</a> eller slet tekst`;
    }
  }

  // Common button state logic
  if (hasText) {
    generateBtn.disabled = false;
    generateBtn.style.backgroundColor = "rgb(232, 107, 134)";
    generateBtn.style.color = "#FFFFFF";
    generateBtn.style.cursor = "pointer";
    generateBtn.style.opacity = "1";
  } else {
    if (quill1.getText().trim().length === 0) {
      quill1.setText("");
    }
    // Disable button and update styles
    generateBtn.disabled = true;
    generateBtn.style.backgroundColor = "#FFFFFF";
    generateBtn.style.color = "#111111";
    generateBtn.style.cursor = "not-allowed";
    generateBtn.style.border = "1px solid grey";
    generateBtn.style.opacity = "0.7";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  updateGenerateButtonState();
});
quill1.on("text-change", updateGenerateButtonState);

// ! +++++++++++++++++++++++++++++++++++++++++++++++ comparison code ++++++++++++++++++++++++++++++++++

function htmlToText(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

function htmlToTextWithSpacing(html) {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  /* ───────────────────── 1. <br> → newline ───────────────────── */
  tempDiv.querySelectorAll("br").forEach((br) => {
    console.log("Replacing <br> with \\n");
    br.replaceWith(document.createTextNode("\n"));
  });

  /* ───────────────────── 2. block-level spacing ───────────────────── */
  const blockElements = tempDiv.querySelectorAll(
    "div, p, h1, h2, h3, h4, h5, h6, ul, ol, li, table, tr, blockquote"
  );

  blockElements.forEach((el) => {
    /* Detect a "strong paragraph" ⇢ <p><strong>…</strong></p> */
    const isStrongParagraph =
      el.tagName === "P" &&
      el.childNodes.length === 1 &&
      el.firstChild.nodeType === Node.ELEMENT_NODE &&
      el.firstChild.tagName === "STRONG";

    /* Normal headings OR our special strong-only paragraph */
    const isHeading = /^H[1-6]$/i.test(el.tagName) || isStrongParagraph;
    const spacing = isHeading ? "\n\n" : "\n";

    /* insert AFTER the element (existing behaviour) */
    const afterNode = document.createTextNode(spacing);
    el.parentNode.insertBefore(afterNode, el.nextSibling);

    /* if heading-like, also insert BEFORE the element */
    if (isHeading) {
      const beforeNode = document.createTextNode(spacing);
      el.parentNode.insertBefore(beforeNode, el);
    }

    console.log(
      `Processing <${el.tagName.toLowerCase()}>: ${
        isHeading ? "heading-like" : "block"
      } – spacing "${JSON.stringify(spacing)}"`
    );
  });

  /* ───────────────────── 3. &nbsp; → space ───────────────────── */
  tempDiv.innerHTML = tempDiv.innerHTML.replace(/&nbsp;/g, " ");

  /* ───────────────────── 4. extract text ───────────────────── */
  let textContent = tempDiv.textContent || tempDiv.innerText || "";

  /* ───────────────────── 5. collapse ≥2 blank lines to exactly 2 ───────────────────── */
  textContent = textContent.replace(/\n\s*\n/g, "\n\n");

  console.log("Final text content:", JSON.stringify(textContent));
  return textContent;
}

function filterHtmlParts(htmlParts) {
  const parser = new DOMParser();

  return htmlParts.filter((html, ind) => {
    const doc = parser.parseFromString(html, "text/html");
    const innerText = doc.body.innerText || "";
    // console.log(`Part ${ind}:`, innerText.length);
    return innerText.trim().length > 0;
  });
}

document.querySelector("#genBtn").addEventListener("click", async () => {
  clearHighlights();
  resetNavText();
  stopSpeaking();
  manuallyCloseMicButton("micButton1");
  noOfChanges = 0;
  resetSidebar();
  document.querySelector(".correction-options").style.display = "flex";
  isUndo = false;
  isSmartCalled = false;
  isExplanations = false;
  lastCorrectedText = "";
  showLoader(".textarea-wrapper", "Retter teksten...");
  showLoader(".correction-message", "Analyzing...");
  analyseLoader(true);

  try {
    const clonedElement = quill1.root.cloneNode(true);
    clonedElement
      .querySelectorAll("ham-dan.grammar-correction-removed")
      .forEach((hamDan) => hamDan.remove());

    originalContent.text = quill1.getText();

    // *** IMPORTANT: Get the raw HTML first ***
    let rawHtml = clonedElement.innerHTML;
    console.log("Raw HTML before emoji normalization:", rawHtml);

    // *** NEW: Normalize emojis BEFORE any other processing ***
    rawHtml = normalizeEmojisInHtml(rawHtml);
    console.log("HTML after emoji normalization:", rawHtml);

    // *** NOW assign the normalized HTML ***
    originalContent.html = rawHtml;

    console.log("before the htmlpar", originalContent.html);

    let htmlParts = processComplexHtml(originalContent.html);
    // console.log("just got htmlParts", htmlParts)
    htmlParts = filterHtmlParts(htmlParts);
    // htmlParts.map((part, ind) => console.log("this is part", ind, part))
    window.currentHtmlParts = htmlParts;
    console.log("htmlParts", htmlParts);
    correctedResults = [];
    // console.log("this is htmlParts", htmlParts)
    if (htmlParts.length === 1) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = htmlParts[0];
      console.log("this is partText", tempDiv.innerHTML);
      const partText = htmlToTextWithSpacing(tempDiv.innerHTML);
      correctedResults = [
        await grammerApi("correction", {
          language: currentLanguage,
          text: partText,
        }),
      ];
    } else {
      const partsParams = htmlParts.map((part) => {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = part;
        // console.log("this is partText", htmlToTextWithSpacing(tempDiv.innerHTML))
        return {
          language: currentLanguage,
          text: htmlToTextWithSpacing(tempDiv.innerHTML),
        };
      });
      correctedResults = await grammerApiParallel("correction", partsParams);
    }

    correctedText = correctedResults.join(" ");

    const diffs = htmlParts.map((part, idx) => {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = part;
      const partText = htmlToTextWithSpacing(tempDiv.innerHTML);
      return identifyDifferences(partText, correctedResults[idx]);
    });
    // console.log("correctedResults", correctedResults)
    const diffHTMLs = diffs.map(generateDiffHTML);
    // console.log("diffHTMLs", diffHTMLs)
    const diffHtml = diffHTMLs.join("");
    diffHTMLExp = diffHtml;
    diffHTMLParts = diffHTMLs;

    noOfChanges = countSpanTags(diffHtml);
    // console.log("total number of changes", noOfChanges);
    mainSwitcher.disabled = false;
    isMainSwtich = true;
    switcherText = "";

    quill1.setContents([]);

    const htmlRes = marked.parse(diffHtml);
    const safeHTML = DOMPurify.sanitize(htmlRes, {
      ADD_TAGS: ["ham-dan"],
      ADD_ATTR: ["class"],
      ALLOWED_ATTR: ["class"],
      KEEP_CONTENT: true,
    });

    quill1.clipboard.dangerouslyPasteHTML(0, safeHTML, "api");
    hideUnderlines(toggleState);

    // ✅ Start both formatting and sidebar (explanations) in parallel
    // Each will handle their own loaders

    // Start formatting (this will handle .textarea-wrapper loader)
    if (htmlParts.length === 1) {
      formatCallingWithLoader(currentLanguage, originalContent.html, diffHtml);
    } else {
      const formattingParts = htmlParts.map((htmlPart, index) => ({
        userInputText: htmlPart,
        correctedText: diffHTMLs[index],
      }));

      formatCallingParallelWithLoader(
        currentLanguage,
        formattingParts,
        diffHtml
      );
    }

    // Start sidebar (explanations) - this will handle .correction-message loader and analyseLoader
    callSidebar();

    adjustInputTextareaHeight();
  } catch (error) {
    console.error("Processing error:", error);
    hideLoader(".textarea-wrapper");
    hideLoader(".correction-message");
    analyseLoader(false);
  }
});

function countSpanTags(htmlString) {
  const matches = htmlString.match(/<ham-dan[^>]*>/g);
  return matches ? matches.length : 0;
}
// Initialize settings for word-level diff only
const SETTINGS = {
  // Basic diff settings
  diffTimeout: 15.0, // Increase computation time for better results
  diffEditCost: 6, // Higher value prefers word boundaries
  // Word-level settings
  minWordLength: 2, // Minimum length to consider a standalone word
  contextSize: 3, // Words of context to consider for better matches
  // Advanced settings
  useWordDiff: true, // Use word-level diffing algorithm
  useLCS: true, // Use Longest Common Subsequence for better matching
  useSemanticCleaning: true, // Use semantic cleaning
  ignoreWhitespace: true, // Consider whitespace changes or not
  caseSensitive: true, // Case sensitive comparison by default
  highlightPunctuation: true, // Highlight punctuation changes by default
};

// Function to identify differences between original and corrected text
function identifyDifferences(originalText, correctedText) {
  // Apply preprocessing based on settings
  let processedOriginalText = originalText;
  let processedCorrectedText = correctedText;

  // Case insensitive if needed
  if (!SETTINGS.caseSensitive) {
    processedOriginalText = processedOriginalText.toLowerCase();
    processedCorrectedText = processedCorrectedText.toLowerCase();
  }

  // Normalize whitespace if needed
  if (SETTINGS.ignoreWhitespace) {
    processedOriginalText = processedOriginalText.replace(/\s+/g, " ").trim();
    processedCorrectedText = processedCorrectedText.replace(/\s+/g, " ").trim();
  }

  // Apply pure word-level diff algorithm
  const diffResult = pureWordDiff(
    processedOriginalText,
    processedCorrectedText
  );

  // Return the optimized diff result
  return diffResult;
}

// Pure word-level diff implementation - uses its own algorithm instead of converting from character diff
function pureWordDiff(oldText, newText) {
  // Split text into words and spaces
  const wordPattern = /[^\s]+|\s+/g;
  const oldWords = oldText.match(wordPattern) || [];
  const newWords = newText.match(wordPattern) || [];

  // Create a matrix for dynamic programming approach
  const matrix = Array(oldWords.length + 1)
    .fill()
    .map(() => Array(newWords.length + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= oldWords.length; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= newWords.length; j++) {
    matrix[0][j] = j;
  }

  // Fill the matrix - Wagner-Fischer algorithm for edit distance
  for (let i = 1; i <= oldWords.length; i++) {
    for (let j = 1; j <= newWords.length; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        // Higher cost for word substitution to prefer insertions/deletions
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + SETTINGS.diffEditCost // substitution with higher cost
        );
      }
    }
  }

  // Backtrack to find the operations
  const diff = [];
  let i = oldWords.length;
  let j = newWords.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      // Words match - no change
      diff.unshift([0, oldWords[i - 1]]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || matrix[i][j - 1] <= matrix[i - 1][j])) {
      // Insert word from new text
      diff.unshift([1, newWords[j - 1]]);
      j--;
    } else if (i > 0) {
      // Delete word from old text
      diff.unshift([-1, oldWords[i - 1]]);
      i--;
    }
  }

  // Post-process the diff to handle special cases
  return postProcessDiff(diff);
}

// Process the diff to merge adjacent changes and handle special cases
function postProcessDiff(diff) {
  // Merge adjacent changes of the same type
  const mergedDiff = mergeAdjacentChanges(diff);

  // Apply special handling for punctuation if needed
  if (SETTINGS.highlightPunctuation) {
    return handlePunctuation(mergedDiff);
  }

  return mergedDiff;
}

// Merge adjacent changes of the same type for cleaner output
function mergeAdjacentChanges(diff) {
  const result = [];
  let lastType = null;
  let lastText = "";

  diff.forEach((part) => {
    if (part[0] === lastType) {
      // Same type as previous, merge them
      lastText += part[1];
    } else {
      // Different type, add the previous one if it exists
      if (lastType !== null) {
        result.push([lastType, lastText]);
      }
      // Start new accumulation
      lastType = part[0];
      lastText = part[1];
    }
  });

  // Add the last accumulated part
  if (lastType !== null) {
    result.push([lastType, lastText]);
  }

  return result;
}

function handlePunctuation(diff) {
  const result = [];

  // Define a function to check for word-with-punctuation patterns
  const isPunctuationOnly = (word1, word2) => {
    // Extract the non-punctuation part of each word
    const baseWord1 = word1.replace(/[,.!?;:]+/g, "");
    const baseWord2 = word2.replace(/[,.!?;:]+/g, "");

    // If the base words are the same but the original words are different,
    // then the difference is only in punctuation
    return baseWord1 === baseWord2 && word1 !== word2;
  };

  // Check if a string is only punctuation
  const isPunctuationString = (str) => {
    return /^[,.!?;:]+$/.test(str);
  };

  // First pass: Look for pairs of deleted/added text that might represent punctuation changes
  for (let i = 0; i < diff.length; i++) {
    const current = diff[i];
    const next = i + 1 < diff.length ? diff[i + 1] : null;
    const nextNext = i + 2 < diff.length ? diff[i + 2] : null;
    const nextNextNext = i + 3 < diff.length ? diff[i + 3] : null;

    // Skip unchanged text
    if (current[0] === 0) {
      result.push(current);
      continue;
    }

    // Enhanced pattern: [0, text] [-1, word] [0, " "] [-1, punctuation] [1, word+punctuation]
    if (current[0] === -1 && next && next[0] === 0) {
      // Check if the previous item was also unchanged text
      const prev = i > 0 ? diff[i - 1] : null;

      if (prev && prev[0] === 0) {
        // Check if the next is a space and followed by punctuation removal and addition
        if (
          next[1] === " " &&
          nextNext &&
          nextNext[0] === -1 &&
          isPunctuationString(nextNext[1]) &&
          nextNextNext &&
          nextNextNext[0] === 1 &&
          nextNextNext[1].endsWith(nextNext[1])
        ) {
          // This matches our enhanced pattern, mark the addition with punctuation class
          result.push([2, " " + nextNextNext[1]]);

          // Skip the next items since we've processed them
          i += 3; // Skip next, nextNext, and nextNextNext
          continue;
        } else {
          // This is a simple word removal pattern
          // Mark with a special type [3] to indicate simple word removal
          result.push([3, current[1]]);
          continue;
        }
      }
    }

    // Check for deletion followed by addition (a potential punctuation change)
    if (current[0] === -1 && next && next[0] === 1) {
      // If the only difference is punctuation, mark the whole word
      if (isPunctuationOnly(current[1], next[1])) {
        // Push a special type [2] to indicate punctuation-only change for the whole word
        result.push([2, next[1]]);
        i++; // Skip the next item since we've processed it
        continue;
      }
    }

    // Check for addition followed by deletion (also a potential punctuation change)
    if (current[0] === 1 && next && next[0] === -1) {
      // If the only difference is punctuation, mark the whole word
      if (isPunctuationOnly(current[1], next[1])) {
        // Push a special type [2] to indicate punctuation-only change for the whole word
        result.push([2, current[1]]);
        i++; // Skip the next item since we've processed it
        continue;
      }
    }

    // Handle words where punctuation might have been added or removed
    const hasPunctuation = /[,.!?;:]+/.test(current[1]);
    const wordWithoutPunctuation = current[1].replace(/[,.!?;:]+/g, "");

    // Look ahead and behind for potential matches (words that differ only in punctuation)
    let foundPunctuationOnlyMatch = false;

    // Check previous item
    if (i > 0) {
      const prev = diff[i - 1];
      if (prev[0] !== 0 && prev[0] !== current[0]) {
        // Different operation type (add vs delete)
        const prevWithoutPunctuation = prev[1].replace(/[,.!?;:]+/g, "");
        if (wordWithoutPunctuation === prevWithoutPunctuation) {
          // Already processed as part of the previous iteration
          foundPunctuationOnlyMatch = true;
        }
      }
    }

    // Check next item
    if (!foundPunctuationOnlyMatch && next) {
      if (next[0] !== 0 && next[0] !== current[0]) {
        // Different operation type
        const nextWithoutPunctuation = next[1].replace(/[,.!?;:]+/g, "");
        if (wordWithoutPunctuation === nextWithoutPunctuation) {
          // Will be processed in the next iteration
          foundPunctuationOnlyMatch = true;
        }
      }
    }

    // If no punctuation-only match was found, process normally
    if (!foundPunctuationOnlyMatch) {
      result.push(current);
    }
  }

  return result;
}
// Generate HTML with underlined differences
function generateDiffHTML(diff) {
  let resultHtml = "";

  // We'll only show specific removed text (type 3) that match our pattern
  const highlightPunctuation = SETTINGS.highlightPunctuation;

  for (let i = 0; i < diff.length; i++) {
    const part = diff[i];

    if (part[0] === 3) {
      // Simple word removal (not replaced by anything)
      // Mark with grammar-correction-removed class
      resultHtml += `<ham-dan class="grammar-correction-removed">${part[1]}</ham-dan>`;
    } else if (part[0] === 2) {
      // Punctuation-only change (whole word marking)
      // Mark the entire word with the punctuation class
      resultHtml += `<ham-dan class="grammar-correction-punctuation">${part[1]}</ham-dan>`;
    } else if (part[0] === 1) {
      // Added text
      // Check if it's purely punctuation
      if (highlightPunctuation && /^[,.!?;:]+$/.test(part[1])) {
        // Underline added punctuation
        resultHtml += `<ham-dan class="grammar-correction-punctuation">${part[1]}</ham-dan>`;
      } else if (/^\s+$/.test(part[1])) {
        // Whitespace changes
        resultHtml += part[1];
      } else {
        // Check if this word contains punctuation that might be the only change
        const hasPunctuation = /[,.!?;:]+/.test(part[1]);
        if (hasPunctuation && highlightPunctuation) {
          // Look for the corresponding removed word to compare
          const prevPart = i > 0 ? diff[i - 1] : null;
          const nextPart = i < diff.length - 1 ? diff[i + 1] : null;

          // Check if previous or next part is a removal and differs only in punctuation
          if (
            (prevPart &&
              prevPart[0] === -1 &&
              part[1].replace(/[,.!?;:]+/g, "") ===
                prevPart[1].replace(/[,.!?;:]+/g, "")) ||
            (nextPart &&
              nextPart[0] === -1 &&
              part[1].replace(/[,.!?;:]+/g, "") ===
                nextPart[1].replace(/[,.!?;:]+/g, ""))
          ) {
            // This is a word that differs only in punctuation
            resultHtml += `<ham-dan class="grammar-correction-punctuation">${part[1]}</ham-dan>`;
          } else {
            // This is a regular addition
            resultHtml += `<ham-dan class="grammar-correction-added">${part[1]}</ham-dan>`;
          }
        } else {
          // For regular text, underline the whole thing as added
          resultHtml += `<ham-dan class="grammar-correction-added">${part[1]}</ham-dan>`;
        }
      }
    } else if (part[0] === -1) {
      // Skip all other removed words - we only want to show the special type 3 removals
      // This is intentionally empty - we don't display regular removed words
    } else if (part[0] === 0) {
      // Unchanged text
      // Don't highlight punctuation in unchanged text
      resultHtml += part[1];
    }
  }

  return resultHtml;
}

// =========================================== utility functions ===============================================
function takeCurrentText() {
  return quill1.root.innerHTML;
}

function collectSpanTags(htmlString) {
  // console.log("in the collectSpanTags function this is htmlString: " + htmlString);
  const results = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  // Get all <ham-dan> elements
  const hamDanElements = doc.querySelectorAll("ham-dan");

  hamDanElements.forEach((el) => {
    // Get flattened text content including text of inner tags
    const textContent = el.textContent;

    // Clone the original tag and replace its content with flat text
    const cloned = el.cloneNode(false); // shallow clone (no children)
    cloned.textContent = textContent;

    // Push the new outerHTML
    results.push(cloned.outerHTML);
  });

  // console.log("results: ", results);
  return results;
}

function cleanMarkdown(markdownText) {
  return markdownText;
}

function convertHtmlToMarkdown(html) {
  //// console.log("in the html to markdown function");
  //// console.log("content of html: " + html);
  var turndownService = new TurndownService();
  return turndownService.turndown(html);
}
function formatMarkdownOutput(htmlContent) {
  return `<div class="markdown-body">${htmlContent}</div>`;
}

function cleanHTML(html) {
  // Create a DOM parser
  const parser = new DOMParser();

  // Parse the HTML string into a document
  const doc = parser.parseFromString(html, "text/html");

  /**
   * Recursively clean elements and remove empty ones
   * @param {Element} element - Element to process
   * @returns {boolean} - True if element has text content (directly or in children) or is a br tag
   */
  function cleanElement(element) {
    if (element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    // Convert styled spans to semantic elements before removing attributes
    if (element.tagName.toLowerCase() === "span") {
      // Get the style attribute
      const styleAttr = element.getAttribute("style");

      if (styleAttr) {
        // Check for bold styling
        if (
          styleAttr.includes("font-weight: 700") ||
          styleAttr.includes("font-weight:700") ||
          styleAttr.includes("font-weight:bold") ||
          styleAttr.includes("font-weight: bold")
        ) {
          // Replace span with strong
          const strong = document.createElement("strong");
          while (element.firstChild) {
            strong.appendChild(element.firstChild);
          }
          element.parentNode.replaceChild(strong, element);
          element = strong;
        }
        // Check for italic styling
        else if (
          styleAttr.includes("font-style: italic") ||
          styleAttr.includes("font-style:italic")
        ) {
          // Replace span with em
          const em = document.createElement("em");
          while (element.firstChild) {
            em.appendChild(element.firstChild);
          }
          element.parentNode.replaceChild(em, element);
          element = em;
        }
      }
    }

    // Always preserve <br> tags
    if (element.tagName.toLowerCase() === "br") {
      // Remove all attributes from br tags too
      while (element.attributes.length > 0) {
        element.removeAttribute(element.attributes[0].name);
      }
      return true;
    }

    // Remove all attributes from the current element
    while (element.attributes.length > 0) {
      element.removeAttribute(element.attributes[0].name);
    }

    // Check if the element has direct text content (excluding whitespace)
    // But preserve elements with &nbsp; entities
    const hasDirectText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .some((textNode) => {
        const content = textNode.textContent;
        // Check for non-breaking space entity or actual non-breaking space character
        return (
          content.trim() !== "" ||
          content.includes("&nbsp;") ||
          content.includes("\u00A0")
        );
      });

    // Track if any child elements have text
    let hasChildWithText = false;

    // Process all child elements recursively
    for (let i = element.children.length - 1; i >= 0; i--) {
      const child = element.children[i];
      const childHasText = cleanElement(child);

      // If child has no text content, remove it
      if (!childHasText) {
        child.remove();
      } else {
        hasChildWithText = true;
      }
    }

    // Return true if this element has direct text or any child with text
    return hasDirectText || hasChildWithText;
  }

  // Start cleaning from the body
  cleanElement(doc.body);

  // Return the cleaned HTML
  return doc.body.innerHTML;
}

//! =================================================== api calls =================================================

function displayResponse(content, scroll = true) {
  const scrollContainer = quill1.scroll.domNode.parentNode;
  let previousScrollTop = 0;

  // 1. Save current scroll position if scroll=false
  if (!scroll) {
    previousScrollTop = scrollContainer.scrollTop;
  }

  // 2. Temporarily disable adjustInputTextareaHeight to prevent interference
  const originalAdjustInputTextareaHeight = adjustInputTextareaHeight;
  let adjustHeightSuppressed = false;
  adjustInputTextareaHeight = () => {
    adjustHeightSuppressed = true;
  };

  // 3. Clear the editor
  quill1.setContents([]);

  // 4. Parse and sanitize the new content
  const html = marked.parse(content);
  const safeHTML = DOMPurify.sanitize(html, {
    ADD_TAGS: ["ham-dan"],
    ADD_ATTR: ["class"],
    ALLOWED_ATTR: ["class"],
    KEEP_CONTENT: true,
  });
  quill1.clipboard.dangerouslyPasteHTML(0, safeHTML, "api");

  // 5. Handle scroll restoration or auto-scroll
  if (!scroll) {
    // Restore scroll position immediately
    scrollContainer.scrollTop = previousScrollTop;

    // Re-enable adjustInputTextareaHeight
    adjustInputTextareaHeight = originalAdjustInputTextareaHeight;

    // Call adjustInputTextareaHeight now that content is in place
    adjustInputTextareaHeight();

    // One more pass to ensure scroll position stays the same after height adjustments
    scrollContainer.scrollTop = previousScrollTop;
  } else {
    // Re-enable adjustInputTextareaHeight before using it
    adjustInputTextareaHeight = originalAdjustInputTextareaHeight;
    adjustInputTextareaHeight();

    // Move cursor to the end, then scroll editor content to bottom
    const length = quill1.getLength();
    quill1.setSelection(length, 0, "silent");
    quill1.root.scrollTop = quill1.root.scrollHeight;
    quill1.focus();
  }

  // 6. Restore behaviors and UI state
  hideUnderlines(toggleState);
  updateGenerateButtonState();
  document.querySelector('.options-container').style.display = 'flex'; // or 'block'
}

const grammerApi = async (type, params) => {
  //// console.log(`Making ${type} request with params: `, params);

  // Prepare data for WordPress AJAX
  const data = {
    action: "korrektur_grammar_v2",
    type: type,
    params: JSON.stringify(params),
  };

  try {
    const response = await fetch(SB_ajax_object.ajax_url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;",
      },
      body: new URLSearchParams(data).toString(),
    });

    const responseData = await response.json();
    //// console.log(`here is the resposne from ${type} api call: `, responseData);
    if (responseData.success) {
      //// console.log(`${type} response: `, responseData.data);
      return responseData.data;
    } else {
      throw new Error(responseData.data || "API request failed");
    }
  } catch (error) {
    console.error(`Error in ${type} call: `, error);
    throw error;
  }
};

function removeEmptyPTags(html) {
  return html.replaceAll("<p><br></p>", "");
}
function convertPSpanstoBr(htmlString) {
  // 1. Create a temporary container and set its innerHTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlString;

  // 2. Find all <p> elements inside the container
  const paragraphs = Array.from(tempDiv.querySelectorAll("p"));

  // 3. For each <p>, check if it contains exactly one child that is an empty <span>
  paragraphs.forEach((p) => {
    const onlyChild = p.firstChild;
    const isSingleEmptySpan =
      p.childNodes.length === 1 &&
      onlyChild.nodeName.toLowerCase() === "span" &&
      onlyChild.textContent.trim() === "";

    // 4. If it matches <p><span></span></p>, replace the <p> with a <br>
    if (isSingleEmptySpan) {
      const br = document.createElement("br");
      p.parentNode.replaceChild(br, p);
    }
  });

  // 5. Return the updated HTML as a string
  return tempDiv.innerHTML;
}

// ✅ formatCalling that manages its own loader
function formatCallingWithLoader(language, userInputText, correctedText) {
  // Change loader text to indicate formatting stage
  hideLoader(".textarea-wrapper");
  showLoader(".textarea-wrapper", "Ordner opsætningen...");

  // Validate input
  if (!language || !userInputText || !correctedText) {
    console.error("Missing required parameters");
    hideLoader(".textarea-wrapper");
    return;
  }
  console.log(
    "before tag removal ",
    convertStrongParagraphsToHeadings(removeHamDanTags(userInputText))
  );
  console.log(
    "after tag removal ",
    convertPSpanstoBr(
      convertStrongParagraphsToHeadings(removeHamDanTags(userInputText))
    )
  );
  // ✅ CLEAN HAM-DAN TAGS BEFORE SENDING
  let cleanedUserInput = convertPSpanstoBr(
    convertStrongParagraphsToHeadings(removeHamDanTags(userInputText))
  );

  // cleanedUserInput = convertHeadingsToStrong(cleanedUserInput);
  cleanedUserInput = cleanedUserInput;
  // console.log("this is userInputText: ", cleanedUserInput);
  jQuery.ajax({
    url: SB_ajax_object.ajax_url,
    type: "POST",
    dataType: "json",
    data: {
      action: "formatting_call_v2",
      language: language,
      userInputText: cleanedUserInput,
      correctedText: correctedText,
    },
    beforeSend: function () {
      // console.log("Sending formatting request...");
    },
    success: function (response) {
      if (response.success) {
        // console.log("response from the formatter: ", response.data);
        let formattedResponse = response.data.replace(/\\/g, "");
        formattedResponse = formattedResponse.replace(/```html|```HTML/g, "");
        formattedResponse = formattedResponse.replace(/```/g, "");
        // console.log("response from the formatter: ", formattedResponse);
        lastCorrectedText = formattedResponse;
        onResponseGenerated(removeHamDanTags(formattedResponse));
        displayResponse(formattedResponse);
        const dropDownValue =
          document.querySelector(".hk-dropdown-text").textContent;
        if (dropDownValue === "Smart teksthjælp") {
          console.log("in formatting call analyzeTranslatedText");
          analyzeTranslatedText();
        }
        adjustInputTextareaHeight();

        hideLoader(".textarea-wrapper"); // ✅ Hide when formatting completes
      } else {
        console.error("Formatting error:", response.data.message);
        hideLoader(".textarea-wrapper"); // ✅ Hide on error
      }
    },
    error: function (xhr, status, error) {
      console.error("AJAX error:", error);
      hideLoader(".textarea-wrapper"); // ✅ Hide on error
    },
  });
}

function formatCallingParallelWithLoader(
  language,
  formattingParts,
  fallbackDiffHtml
) {
  hideLoader(".textarea-wrapper");
  showLoader(".textarea-wrapper", "Ordner opsætningen...");

  // ✅ CLEAN HAM-DAN TAGS FROM ALL PARTS
  const cleanedFormattingParts = formattingParts.map((part) => ({
    // userInputText: convertHeadingsToStrong(removeHamDanTags(part.userInputText)), // ✅ Clean each part
    userInputText: convertPSpanstoBr(
      convertStrongParagraphsToHeadings(removeHamDanTags(part.userInputText))
    ),
    correctedText: part.correctedText,
  }));

  formatCallingParallel(language, cleanedFormattingParts)
    .then((formattingResults) => {
      // console.log("Parallel formatting results:", formattingResults);
      const combinedResult = combineFormattingResults(formattingResults);
      lastCorrectedText = combinedResult;
      // console.log("here are the combined results from parallel formatting: ", combinedResult);
      displayResponse(combinedResult);
      onResponseGenerated(removeHamDanTags(combinedResult));
      const dropDownValue =
        document.querySelector(".hk-dropdown-text").textContent;
      if (dropDownValue === "Smart teksthjælp") {
        console.log("in formatting call parallel analyzeTranslatedText");
        analyzeTranslatedText();
      }
      adjustInputTextareaHeight();
      hideLoader(".textarea-wrapper");
    })
    .catch((error) => {
      console.error("Parallel formatting error:", error);
      // ✅ Clean fallback diff HTML too
      // const cleanedFallback = removeHamDanTags(cleanHTML(originalContent.html));
      // formatCallingWithLoader(language, cleanedFallback, fallbackDiffHtml);
    });
}

// ✅ Keep the original formatCalling for backward compatibility (if needed elsewhere)
function formatCalling(language, userInputText, correctedText) {
  // Validate input
  if (!language || !userInputText || !correctedText) {
    console.error("Missing required parameters");
    return;
  }

  jQuery.ajax({
    url: SB_ajax_object.ajax_url,
    type: "POST",
    dataType: "json",
    data: {
      action: "formatting_call_v2",
      language: language,
      userInputText: userInputText,
      correctedText: correctedText,
    },
    beforeSend: function () {
      // console.log("Sending formatting request...");
    },
    success: function (response) {
      if (response.success) {
        let formattedResponse = response.data.replace(/\\/g, "");
        formattedResponse = formattedResponse.replace(/```html|```HTML/g, "");
        formattedResponse = formattedResponse.replace(/```/g, "");

        lastCorrectedText = formattedResponse;
        displayResponse(formattedResponse);
        onResponseGenerated(removeHamDanTags(formattedResponse));
        if (originalContent) {
          analyzeTranslatedText();
        }
        adjustInputTextareaHeight();
      } else {
        console.error("Formatting error:", response.data.message);
      }
    },
    error: function (xhr, status, error) {
      console.error("AJAX error:", error);
    },
  });
}

// ======================================================= Input Feild big code ===============================================

// ! =============================================== Explanation display of the improve inner code =================================
/**
 * Manually parses the raw explanation text from the API
 * @param {string} rawExplanation - The raw text returned from the API
 * @return {Array} - An array of explanation objects
 */
function parseExplanationManually(rawExplanation) {
  // First clean up the text by removing JSON formatting markers
  let cleaned = rawExplanation
    .replace(/^```json|```$/g, "") // Remove JSON code block markers
    .replace(/^{[\s\S]*?"explanations":\s*\[/m, "") // Remove the opening part
    .replace(/\s*\]\s*\}\s*$/m, "") // Remove the closing part
    .trim();

  // Split by the pattern that likely indicates new explanation entries (looking for the start of a new object)
  let entries = cleaned.split(/\s*\},\s*\{\s*/);

  if (entries.length === 1 && !entries[0].includes('"change"')) {
    // If we don't see expected formatting, try an alternative approach
    // This might occur if the raw string doesn't match expected patterns
    entries = cleaned.split(/\s*\},\s*\{/);
  }

  // Clean up the first and last entry to remove any remaining brackets
  if (entries.length > 0) {
    entries[0] = entries[0].replace(/^\s*\{\s*/, "");
    let lastIndex = entries.length - 1;
    entries[lastIndex] = entries[lastIndex].replace(/\s*\}\s*$/, "");
  }

  // Parse each entry into an object
  const explanations = entries
    .map((entry) => {
      // Extract change and reason using regex
      const changeMatch = entry.match(/"change"\s*:\s*"([^"]+)"/);
      const reasonMatch = entry.match(/"reason"\s*:\s*"([^"]+)"/);

      if (changeMatch && reasonMatch) {
        // Process the change string to handle special characters
        let change = changeMatch[1]
          .replace(/→/g, "➜") // Normalize arrows to your preferred arrow (➜)
          .replace(/"/g, '"') // Normalize quotes
          .replace(/"/g, '"'); // Normalize quotes

        return {
          change: change,
          reason: reasonMatch[1],
        };
      }
      return null;
    })
    .filter((item) => item !== null);

  return explanations;
}

/**
 * Process raw explanation data into a usable format
 * @param {string} rawExplanation - The raw explanation text from API
 * @return {Array} - Array of explanation objects
 */
function processExplanations(rawExplanation) {
  //// console.log("Processing raw explanation data");

  try {
    // Try standard JSON parsing first with cleaning
    const cleanedResults = rawExplanation
      .replace(/^`+|`+$/g, "") // Remove backticks
      .replace(/^(json|JSON)\s*/i, "") // Remove 'json' or 'JSON'
      .replace(/→/g, "➜") // Normalize arrows to your preferred arrow
      .replace(/"/g, '"') // Normalize quotes
      .replace(/"/g, '"') // Normalize quotes
      .trim();

    try {
      const explanationResultsObj = JSON.parse(cleanedResults);
      //// console.log("Standard JSON parsing successful");
      return explanationResultsObj.explanations;
    } catch (error) {
      //// console.log("Standard JSON parsing failed, trying aggressive cleanup");

      try {
        // Try more aggressive cleaning before giving up on JSON parse
        const ultraCleanedResults = cleanedResults
          .replace(/[\u201C\u201D]/g, '"') // Replace curly quotes
          .replace(/[^\x00-\x7F]/g, ""); // Remove non-ASCII characters

        const ultraParsedResults = JSON.parse(ultraCleanedResults);
        //// console.log("Ultra-cleaned parsing successful");
        return ultraParsedResults.explanations;
      } catch (ultraError) {
        //// console.log("Ultra-clean parsing failed, falling back to manual parsing");
        return parseExplanationManually(rawExplanation);
      }
    }
  } catch (e) {
    console.error("Error processing explanations:", e);
    return [];
  }
}

/**
 * Main function to process grammar explanation results
 * @param {string} explanationResults - Raw explanation results from API
 */
function processGrammarExplanations(explanationResults) {
  //// console.log("Raw explanationResults", explanationResults);

  // Process the explanations using our custom parser
  const parsedExplanations = processExplanations(explanationResults);
  const cleanParsedExplanations = parsedExplanations.filter(
    (item) => !item.reason.startsWith("Ingen ændring")
  );
  // Display the processed explanations
  if (parsedExplanations && parsedExplanations.length > 0) {
    //// console.log("Successfully parsed explanations:", parsedExplanations);
    //// console.log("Successfully clean the parsed explanations:", cleanParsedExplanations);

    displayExplanations(cleanParsedExplanations);
  } else {
    console.error("Failed to parse explanations or no explanations found");

    // Use your existing empty explanations handler
    const sidebarContent = document.querySelector(".correction-content");
    if (sidebarContent) {
      if (sidebarContent.classList.contains("has-explanations")) {
        sidebarContent.classList.remove("has-explanations");
      }
      sidebarContent.innerHTML = `
            <div id="gif" ></div>
            <div class="correction-message">
                <span style="color:#2DB62D" >Teksten er korrekt</span>
            </div>
            `;
      lottieLoadAnimation();
    }
  }
}

/**
 * Display explanations in the sidebar
 * @param {Array} explanations - Array of explanation objects
 */
const displayExplanations = (explanations) => {
  //// console.log("Displaying explanations:", explanations);

  const sidebarContent = document.querySelector(".correction-content");
  //// console.log("Sidebar content element:", sidebarContent);

  // Check if explanations array is empty
  if (!explanations || explanations.length === 0) {
    //// console.log("No explanations provided, handling empty case.");
    if (
      sidebarContent &&
      sidebarContent.classList.contains("has-explanations")
    ) {
      sidebarContent.classList.remove("has-explanations");
    }
    sidebarContent.innerHTML = `
        <div id="gif" ></div>
        <div class="correction-message">
            <span style="color:#2DB62D" >Teksten er korrekt</span>
        </div>
        `;
    lottieLoadAnimation();
    //// console.log("Updated sidebarContent innerHTML for no explanations case.");
    return; // Exit early
  }

  //// console.log("Explanations provided, processing...");

  // Clear previous content
  sidebarContent.innerHTML = "";
  //// console.log("Cleared sidebarContent innerHTML.");

  // Add class to handle different layout
  sidebarContent.classList.add("has-explanations");
  //// console.log("Added 'has-explanations' class to sidebarContent.");
  // Create a container for the number of changes
  const noOfChangesDiv = document.createElement("div");
  noOfChangesDiv.className = "no-of-changes";
  noOfChangesDiv.innerHTML = `<span class="no-of-changes-text">Fejl </span> <span class="no-of-changes-count">${explanations.length}</span>`;
  //// console.log("Created noOfChangesDiv element:", noOfChangesDiv);

  const explanationList = document.createElement("div");
  explanationList.className = "explanation-list";
  //// console.log("Created explanationList element:", explanationList);

  explanations.forEach((item) => {
    //// console.log("Processing explanation item:", item);

    // Split the text at the arrow - handle both arrow types
    const arrowSplitRegex = /(?:➜|→)/;
    const parts = item.change.split(arrowSplitRegex);
    const before = parts[0] ? parts[0].trim() : "";
    const after = parts[1] ? parts[1].trim() : "";

    //// console.log("Split change text into before:", before, "and after:", after);

    const explanationItem = document.createElement("div");
    explanationItem.className = "explanation-item";
    explanationItem.innerHTML = `
        <div class="change-text">
            <span class="not-corrected">${before}</span>
            <span class="corrected">➜ ${after}</span>
        </div>
        <div class="change-reason">${item.reason}</div>
      `;
    //// console.log("Created explanationItem element:", explanationItem);

    explanationList.appendChild(explanationItem);
    //// console.log("Appended explanationItem to explanationList.");
  });

  // First add the number of changes div to the sidebar
  sidebarContent.appendChild(noOfChangesDiv);
  //// console.log("Appended noOfChangesDiv to sidebarContent.");

  // Then add the explanation list
  sidebarContent.appendChild(explanationList);
  //// console.log("Appended explanationList to sidebarContent.");

  // Add fade-in animation
  noOfChangesDiv.classList.add("fade-in");
  explanationList.classList.add("fade-in");
  //// console.log("Added 'fade-in' class to elements.");
  attachExplanationListeners();
};

// Attach click listeners to explanation items
function attachExplanationListeners() {
  //// console.log("Attaching event listeners to explanation items");
  const explanationItems = document.querySelectorAll(".explanation-item");

  explanationItems.forEach((item) => {
    // Remove any existing event listeners to prevent duplicates
    item.removeEventListener("click", handleExplanationClick);

    // Add a new event listener
    item.addEventListener("click", handleExplanationClick);
  });
}

// Event handler for explanation item clicks
function handleExplanationClick(event) {
  const item = event.currentTarget;

  /* 0 ── Toggle­-off: was this item already active? */
  if (item.classList.contains("active-explanation")) {
    clearHighlights(); // un-mark editor & reset sidebar
    item.classList.remove("active-explanation");
    return; // stop – nothing else to do
  }

  /* 1 ── Normal flow: make this item active, others inactive */
  document
    .querySelectorAll(".explanation-item.active-explanation")
    .forEach((el) => el.classList.remove("active-explanation"));
  item.classList.add("active-explanation");

  /* 2 ── Pull the two text versions */
  const correctedSpan = item.querySelector(".corrected");
  const notCorrectedSpan = item.querySelector(".not-corrected");
  if (!correctedSpan) return;

  const correctedText = correctedSpan.textContent.replace("➜", "").trim();
  const notCorrectedText = notCorrectedSpan.textContent.trim();

  /* 3 ── Try highlighting the *corrected* text first,
            fallback to the *original* if no hit */
  if (!highlightWordInInput(correctedText)) {
    highlightWordInInput(notCorrectedText);
  }
}

/**
 * Highlight the first substring that
 *   • shares ≥ threshold similarity with the clicked word, and
 *   • has **any** character living inside a ham-dan blot.
 *
 * @param {string} word       Word/phrase from the sidebar.
 * @param {number} threshold  Similarity 0…1 (default 0.80).
 * @returns {boolean}         True if something was highlighted.
 */
function highlightWordInInput(word, threshold = 0.8) {
  /* ─── 1. Clean up ─────────────────────────────────────────────── */
  document
    .querySelectorAll('.ql-editor [style*="FFF1C2"]')
    .forEach((el) => el.style.removeProperty("background-color"));
  quill1.formatText(0, quill1.getLength(), "mark", false, Quill.sources.API);
  if (!word) return false;

  const needle = word.trim().toLowerCase();
  const nLen = needle.length;
  if (!nLen) return false;
  if (nLen < 4) threshold = 1.0; // exact for very short words

  /* ─── 2. Helpers ──────────────────────────────────────────────── */
  const levenshtein = (a, b) => {
    const m = a.length,
      n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[n];
  };
  const similarity = (a, b) =>
    (Math.max(a.length, b.length) - levenshtein(a, b)) /
    Math.max(a.length, b.length);

  const charHasGrammar = (pos) => {
    const f = quill1.getFormat(pos, 1);
    return f["grammar-added"] || f["grammar-removed"] || f["grammar-punct"];
  };

  /* ─── 3. Fuzzy-search the entire document ─────────────────────── */
  const haystack = quill1.getText().toLowerCase();
  const docLen = haystack.length;

  // Search windows from nLen-1 … nLen+2 chars (tweak as desired)
  for (let winLen = Math.max(1, nLen - 1); winLen <= nLen + 2; winLen++) {
    for (let pos = 0; pos <= docLen - winLen; pos++) {
      // quick reject by first char to save work (optional)
      // if (haystack[pos] !== needle[0]) continue;

      const slice = haystack.substr(pos, winLen);
      if (similarity(needle, slice) < threshold) continue;

      // ── At least one char inside ham-dan? ──────────────────
      let insideGrammar = false;
      for (let i = 0; i < winLen; i++) {
        if (charHasGrammar(pos + i)) {
          insideGrammar = true;
          break;
        }
      }
      if (!insideGrammar) continue;

      // ── Found the first good hit → highlight and bail out ──
      quill1.formatText(pos, winLen, "mark", true, Quill.sources.API);

      // force visual yellow
      document
        .querySelectorAll(".ql-editor mark.word-highlight")
        .forEach((mark) => {
          mark.style.setProperty("background-color", "#FFF1C2", "important");
          mark
            .querySelectorAll("*")
            .forEach((child) =>
              child.style.setProperty(
                "background-color",
                "#FFF1C2",
                "important"
              )
            );
        });
      return true;
    }
  }
  return false; // nothing matched well enough
}

function clearHighlights() {
  if (!quill1) return;

  /* 1 ─── Remove Quill's "mark" format from the whole doc */
  quill1.formatText(0, quill1.getLength(), "mark", false, Quill.sources.API);

  /* 2 ─── Strip inline yellow styling, if any */
  document
    .querySelectorAll(
      '.ql-editor mark.word-highlight, .ql-editor [style*="FFF1C2"]'
    )
    .forEach((el) => el.style.removeProperty("background-color"));

  /* 3 ─── Reset the sidebar: no item stays active */
  document
    .querySelectorAll(".explanation-item.active-explanation")
    .forEach((item) => item.classList.remove("active-explanation"));

  /* 4 ─── Optional UX: collapse the selection so the caret vanishes */
  quill1.setSelection(null);
}

const resetSidebar = () => {
  //// console.log("Resetting sidebar to initial state");

  const sidebarContent = document.querySelector(".correction-content");

  // Remove the has-explanations class if it exists
  if (sidebarContent && sidebarContent.classList.contains("has-explanations")) {
    sidebarContent.classList.remove("has-explanations");
    //// console.log("Removed 'has-explanations' class from sidebarContent");
  }

  // Clear previous content and set the initial state
  sidebarContent.innerHTML = `
        <div class="hamdan-robot-container">
            <!-- Speech bubble comes first -->
            <div class="hamdan-speech-bubble">
                Jeg er klar!
            </div>
            <!-- Container for your animation -->
            <div id="gif" ></div>
        </div>
        <div class="correction-message" style="display: none;">
            <div class="gradient-loader-smart" style="display: none;"></div>
            <span>Jeg er klar!</span>
        </div>
    `;
  lottieLoadAnimation();
  //// console.log("Reset sidebarContent to initial state with GIF and 'Jeg er klar!' message");

  const demoInner = document.querySelector(".demo-inner");
  console.log("demoInner", demoInner);
  demoInner.style.display = "flex";
  const bubble = document.querySelector(".demo-inner .hamdan-speech-bubble");
  bubble.style.display = "block";
  const textSpan = document.querySelector(".demo-inner span");
  textSpan.style.display = "none";
  const correctionInner = document.querySelector(".correction-inner-main");
  correctionInner.style.display = "none";
  document.querySelector(".correction-inner").style.paddingTop = "0";
  const bubbleFun = document.querySelector(
    ".correction-inner .demo-inner .hamdan-robot-container .hamdan-speech-bubble"
  );
  bubbleFun.style.display = "block";
  bubbleFun.textContent = "Jeg er klar!";
};
const noChangeResultImproveInner = () => {
  const sidebarContent = document.querySelector(".correction-content");
  if (sidebarContent && sidebarContent.classList.contains("has-explanations")) {
    sidebarContent.classList.remove("has-explanations");
  }
  sidebarContent.innerHTML = `
        <div class="hamdan-robot-container">
            <!-- Speech bubble comes first -->
            <div class="hamdan-speech-bubble" >
                Perfekt!
            </div>
            <!-- Container for your animation -->
            <div id="gif" ></div>
        </div>
        <div class="correction-message">
            <div class="no-change-improve-outsider">
                <div class="no-changes-impove-inner">
                    <svg width="24px" height="24px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 87.98 88.05">
                        <g>
                            <path d="M41.57.34c6.69-1.76,7.85,3.87,12.64,4.85,3.28.67,7.09-.29,10.29.13,4.97.65,4.75,6.88,7.75,10.12,2.7,2.92,8.88,3.67,10.07,6.31,1.25,2.78-.16,8.61.56,12.1.77,3.76,4.95,5.52,5.12,9.83.19,5.12-4.28,6.51-5.12,10.6-.79,3.86,1.02,10.07-1.23,12.91-1.76,2.21-6.31,2.54-9.02,5.12-2.86,2.72-3.73,8.91-6.31,10.07-2.78,1.25-8.61-.16-12.1.56-3.76.77-5.52,4.95-9.83,5.12-5.12.19-6.51-4.28-10.6-5.12-3.86-.79-10.07,1.02-12.91-1.23-2.21-1.76-2.54-6.31-5.12-9.02-2.72-2.86-8.91-3.73-10.07-6.31-1.25-2.78.16-8.61-.56-12.1C4.35,50.51.17,48.76,0,44.45c-.19-5.12,4.28-6.51,5.12-10.6.67-3.28-.29-7.09.13-10.29.65-4.97,6.88-4.75,10.12-7.75,2.92-2.7,3.67-8.88,6.31-10.07,2.78-1.25,8.61.16,12.1-.56,3.11-.64,5.45-4.24,7.79-4.85Z" style="fill:#096;" />
                            <path d="M58.67,29.32c-3.81.84-17.48,17.7-18.77,17.7-3.08-2.28-7.5-9.17-11.23-9.65-4.36-.56-7.31,2.39-5.94,6.72.33,1.04,12.97,14.21,14.15,14.89,1.55.89,3.35,1.08,5.1.55,3.46-1.05,18.85-19.76,23.03-23.11,2.05-4.73-1.53-8.17-6.34-7.11Z" style="fill:#fff;" />
                        </g>
                    </svg>
                    <span class="correct-text-heading">Teksten er korrekt</span>
                </div>
                
            </div>
        </div>
    `;
  lottieLoadAnimation();
};
// ==================================================== loaders ===========================================
const showLoader = (selector, text) => {
  // console.log("showLoader called for selector:", selector);

  updateClearRevertButtonState("true");
  const element = document.querySelector(selector);
  if (!element) return;

  // Different loader implementations based on selector
  if (selector === ".textarea-wrapper") {
    // Loader 1: For textarea
    element.insertAdjacentHTML(
      "beforeend",
      `
            <div class="loader-backdrop">
                <div class="bubble-loader">
                    <div class="bubble"></div>
                </div>
                <span class="loader-text">${text || "Loading..."}</span>
            </div>
        `
    );
  } else if (selector === ".correction-message") {
    if (toggleState === false) return;
    // Loader 2: For correction content
    // console.log("inside the correction-message loader")
    const correctionContent = document.querySelector(".correction-content");

    if (
      correctionContent &&
      correctionContent.classList.contains("has-explanations")
    ) {
      correctionContent.classList.remove("has-explanations");
    }
    // correctionContent.innerHTML = "";
    correctionContent.innerHTML = `
        <div id="gif"></div>
        <div class="correction-message">
            <span>Arbejder...</span>
        </div>
        `;

    lottieLoadAnimation();
    const span = document.querySelector(".correction-message");
    if (span) {
      span.insertAdjacentHTML(
        "afterbegin",
        `
            <div class="gradient-loader"></div>
            `
      );
    }
  }
};

const hideLoader = (selector) => {
  // console.log("hideLoader called for selector:", selector)
  const element = document.querySelector(selector);

  updateClearRevertButtonState("false");
  if (!element) return;

  if (selector === ".correction-message") {
    const loader = document.querySelector(".gradient-loader");
    if (loader) {
      loader.remove();
    }
    // ✅ Change text back to "Jeg er klar!" when hiding correction-message loader
    const messageSpan = document.querySelector(".correction-message span");
    if (messageSpan) {
      messageSpan.textContent = "Jeg er klar!";
      // console.log("hideLoader - changed correction-message text to 'Jeg er klar!'");
    }
  }

  if (selector === ".textarea-wrapper") {
    // Remove any loader backdrops
    const loaders = element.querySelectorAll(".loader-backdrop");
    loaders.forEach((loader) => loader.remove());
  }
};
// ---------------------------- cleaning response data ----------------------------
function cleanResponse(input) {
  let formattedResponse = input.replace(/\\/g, "");

  // Remove ```html or ```HTML and the closing ```
  formattedResponse = formattedResponse.replace(/```html|```HTML/g, "");
  formattedResponse = formattedResponse.replace(/```/g, "");

  return formattedResponse;
}
// ==================================================== Sidebar other dropdowns logics ===========================================
// ------------------------ Style inner buttons logic -------------------------

// Add click handlers to style options and send requests
document.querySelectorAll(".style-option").forEach((option, index) => {
  option.addEventListener("click", function () {
    // false && true
    // true && true
    // console.log(!quill1.getText().trim().length && !lastCorrectedText.trim().length);
    if (!quill1.getText().trim().length || !lastCorrectedText.trim().length) {
      return;
    }

    // Get prompt number based on index (1-4)
    const promptNumber = index + 1;
    previousText = quill1.root.innerHTML;
    let textToSent = removeHamDanTags(lastCorrectedText);
    //// console.log("saving in the previous text", previousText);
    // console.log("What text we are sending to the style change api \n", textToSent)

    // console.log("text \n ", htmlToText(textToSent));
    // Call function to handle style change
    sendStyleChangeRequest(textToSent, promptNumber);
  });
});

// Function to send style change request
function sendStyleChangeRequest(text, promptNumber) {
  showLoader(".textarea-wrapper", "Forbedre teksten...");
  if (!rewriteResponses[currentParagraphIndex]) {
    rewriteResponses[currentParagraphIndex] = {
      responses: [text],
    };
    // //// console.log('Initialized response storage for the current paragraph index.');
  }
  // Prepare form data
  const formData = new FormData();
  formData.append("action", "handle_style_change_grammer_v2");
  formData.append("text", text);
  formData.append("prompt_number", promptNumber);
  formData.append("language", currentLanguage);

  // Send request
  fetch(SB_ajax_object.ajax_url, {
    method: "POST",
    credentials: "same-origin",
    body: new URLSearchParams(formData),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} `);
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        // Update textarea with styled text
        const content = cleanResponse(data.data);

        displayResponse(content);
        onResponseGenerated(content);

        showNavigation();
        // Store response and update counter
        // Add new response and update navigation
        rewriteResponses[currentParagraphIndex].responses.push(content);
        const responseCount =
          rewriteResponses[currentParagraphIndex].responses.length;
        document.querySelector(
          ".response-counter"
        ).textContent = `Tekst ${responseCount} ud af ${responseCount}`;
      } else {
        throw new Error(data.data?.message || "Style change failed");
      }
    })
    .catch((error) => {
      console.error("Style change request failed:", error);
      alert("Failed to change text style. Please try again.");
    })
    .finally(() => {
      hideLoader(".textarea-wrapper");
    });
}

// analyse loader
function analyseLoader(flag) {
  if (toggleState === false) return;

  const loader = document.querySelector(".gradient-loader-smart");
  const messageSpan = document.querySelector(".correction-message2 span"); // ✅ Target the span inside correction-message2
  const bubble = document.querySelector(
    ".correction-inner .demo-inner .hamdan-robot-container .hamdan-speech-bubble"
  );
  if (flag) {
    if (loader) loader.style.display = "block";
    messageSpan.style.display = "block";
    bubble.style.display = "none";
    if (messageSpan) messageSpan.textContent = "Arbejder..."; // ✅ Change text when showing
    // console.log("analyseLoader true - showing loader and changing text to 'Arbejder...'");
  } else {
    if (loader) loader.style.display = "none";
    if (messageSpan) messageSpan.textContent = "Jeg er klar!"; // ✅ Change text back when hiding
    // console.log("analyseLoader false - hiding loader and changing text to 'Jeg er klar!'");
  }
  // lottieLoadAnimation();
}
// ------------------------ correction inner buttons logic -------------------------
function getInnerTextFromHTMLString(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  // innerHTML of the body
  const innerHTML = doc.body.innerHTML;

  // Convert innerHTML back to a DOM element
  const tempContainer = document.createElement("div");
  tempContainer.innerHTML = innerHTML;

  // Get the innerText (textContent would also work here)
  return tempContainer.innerText;
}
// Store the improvement prompt globally for later use
let savedImprovementPrompt = "";
let analyseAttempts = 1;

function analyzeTranslatedText() {
  // console.log("in the analyzeTranslatedText function");
  if (toggleState === false) return;
  if (isSmartCalled) return;
  if (getInnerTextFromHTMLString(lastCorrectedText).length < 100) {
    analyseLoader(false);
    const bubble = document.querySelector(
      ".correction-inner .demo-inner .hamdan-robot-container .hamdan-speech-bubble"
    );
    bubble.style.display = "block";
    bubble.textContent = "Teksten er for kort...";
    document.querySelector(".demo-text-correction-inner").style.display =
      "none";
    isSmartCalled = true;
    return;
  }
  // ✅ Only show analyseLoader if not already shown
  // (this prevents duplicate loader calls when switching tabs)
  const smartLoader = document.querySelector(".gradient-loader-smart");
  if (smartLoader && smartLoader.style.display === "none") {
    analyseLoader(true);
  }

  // Prepare form data
  const formData = new FormData();
  formData.append("action", "analyze_text_style_grammer_v2");
  formData.append("text", removeHamDanTags(lastCorrectedText));
  formData.append("language", currentLanguage);
  // console.log("\n============================== Data sending to Analyze call ================================\n")
  // console.log("text sending:\n", originalContent.html);

  // Send request
  fetch(SB_ajax_object.ajax_url, {
    method: "POST",
    credentials: "same-origin",
    body: new URLSearchParams(formData),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        // More robust cleaning approach for string responses
        let cleanedString =
          typeof data.data === "string" ? data.data : JSON.stringify(data.data);

        // Remove markdown code blocks
        cleanedString = cleanedString.replace(/```(?:json)?\s*\n?|```/g, "");

        // Trim whitespace
        cleanedString = cleanedString.trim();

        let parsedData;
        try {
          // Try to parse as-is first
          parsedData = JSON.parse(cleanedString);
        } catch (firstError) {
          // console.log("First parse attempt failed, trying to fix newlines...");

          try {
            // More sophisticated newline fixing
            // This regex finds newlines that are inside string values (between quotes)
            // and escapes them, while preserving structural newlines
            let fixedString = cleanedString.replace(
              /"([^"\\]*(\\.[^"\\]*)*)"/g,
              function (match, content) {
                // Escape newlines and other control characters within string values
                return (
                  '"' +
                  content
                    .replace(/\n/g, "\\n")
                    .replace(/\r/g, "\\r")
                    .replace(/\t/g, "\\t") +
                  '"'
                );
              }
            );

            parsedData = JSON.parse(fixedString);
            // console.log("Successfully parsed after fixing newlines");
          } catch (secondError) {
            // console.log("Second parse attempt failed, trying alternative approach...");

            try {
              // Last resort: try to extract JSON using a more aggressive approach
              // Find the first { and last } to extract the JSON object
              const startIndex = cleanedString.indexOf("{");
              const lastIndex = cleanedString.lastIndexOf("}");

              if (
                startIndex !== -1 &&
                lastIndex !== -1 &&
                startIndex < lastIndex
              ) {
                let jsonString = cleanedString.substring(
                  startIndex,
                  lastIndex + 1
                );

                // Fix common JSON issues
                jsonString = jsonString
                  .replace(/\n\s*\n/g, "\\n") // Replace double newlines
                  .replace(/([^\\])\n/g, "$1\\n") // Escape single newlines
                  .replace(/\n/g, "\\n") // Escape any remaining newlines
                  .replace(/\r/g, "\\r")
                  .replace(/\t/g, "\\t");

                parsedData = JSON.parse(jsonString);
                // console.log("Successfully parsed using fallback method");
              } else {
                throw new Error("Could not find valid JSON structure");
              }
            } catch (thirdError) {
              console.error("All parsing attempts failed:", thirdError);
              throw thirdError;
            }
          }
        }

        processedData = parsedData;

        // Validate the processed data structure
        if (processedData && processedData.analysis) {
          updateAnalysisUI(processedData.analysis);
          // Save the improvement prompt for later use
          savedImprovementPrompt = processedData.improvementPrompt;
          isImproved = true;
          isSmartCalled = true;
        } else {
          throw new Error("Invalid response structure - missing analysis data");
        }
      } else {
        throw new Error("Server returned error response");
      }
    })
    .catch((error) => {
      console.error("Text analysis failed:", error);
      if (analyseAttempts < 2) {
        // console.log("failed to analyze, retrying...");
        analyseAttempts++;
        analyzeTranslatedText();
      } else {
        // console.log("failed to analyze after retry");
        const preDefinedText = {
          textType: "Besked",
          issue: "Gør teksten mere præcis og forståelig.",
          currentStyle: "Uformel",
          targetStyle: "Professionel",
          buttonText: "Forbedre teksten",
        };
        updateAnalysisUI(preDefinedText);
        // ✅ Hide loader on failure
        analyseLoader(false);
      }
    })
    .finally(() => {
      // ✅ Hide the loader regardless of success or error (if API completes)
      if (isSmartCalled || analyseAttempts >= 2) {
        // analyseLoader(false);
        console.log(
          `inside the final block \n isSmartCalled : ${isSmartCalled}`
        );
        isImproved = true;
        isSmartCalled = true;
        updateClearRevertButtonState();
      }
    });
}
// Function to update the UI with analysis results
function updateAnalysisUI(analysis) {
  // Update text type
  document.querySelector(".analysis-subtitle").textContent = analysis.textType;

  // Update warning message
  document.querySelector(".warning-msg").textContent = analysis.issue;

  // Update style conversion labels
  document.querySelector(".style-label.informal").textContent =
    analysis.currentStyle;
  document.querySelector(".style-label.professional").textContent =
    analysis.targetStyle;

  // Update action button text
  document.querySelector(".action-button").textContent = analysis.buttonText;

  // document.querySelector('.correction-inner').style.display = 'flex';
  document.querySelector(".correction-inner").style.paddingTop = "16px";
  document.querySelector(".demo-inner").style.display = "none";

  document.querySelector(".correction-inner-main").style.display = "flex";
  // updateDropdownFromPanel(correctionInner);
}

// Add click handler for the action button
document.querySelector(".action-button").addEventListener("click", function () {
  if (!savedImprovementPrompt) {
    // console.error('No improvement prompt available');
    // return;
  }
  if (!isImproved) {
    // ! handle this function
    handleUndo();
    // //// console.log("this is fun")
  } else {
    previousText = takeCurrentText();
    // //// console.log("savedImprovementPrompt:\n", savedImprovementPrompt)
    //// console.log("translated Text", takeCurrentText())
    improveText(savedImprovementPrompt);

    document.querySelector(".action-button").innerHTML = `
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="9.99996" cy="9.99984" r="8.33333" stroke="#ffff" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M13.3333 7.9165H14.0833C14.0833 7.50229 13.7475 7.1665 13.3333 7.1665V7.9165ZM14.0833 14.1665V7.9165H12.5833V14.1665H14.0833ZM6.66663 8.6665H13.3333V7.1665H6.66663V8.6665Z" fill="#ffff"/>
          <path d="M8.74996 5.83301L6.66663 7.91634L8.74996 9.99967" stroke="#ffff" stroke-width="1.5"/>
        </svg>
        <span>Oprindelig tekst</span>
      `;
    isImproved = false;
  }
});

// --------------------------------- show original button logic ---------------------------------
function handleUndo() {
  if (!isUndo) {
    // textarea.innerText = previousText;
    //// console.log("in undo previous text", previousText);
    displayResponse(previousText, false);
    adjustInputTextareaHeight();
    isUndo = true;
    document.querySelector(".action-button").innerHTML = `
        
        <span>Ny tekst</span>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: scaleX(-1);">
          <circle cx="9.99996" cy="9.99984" r="8.33333" stroke="#ffff" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M13.3333 7.9165H14.0833C14.0833 7.50229 13.7475 7.1665 13.3333 7.1665V7.9165ZM14.0833 14.1665V7.9165H12.5833V14.1665H14.0833ZM6.66663 8.6665H13.3333V7.1665H6.66663V8.6665Z" fill="#ffff"/>
          <path d="M8.74996 5.83301L6.66663 7.91634L8.74996 9.99967" stroke="#ffff" stroke-width="1.5"/>
        </svg>
      `;
  } else {
    // textarea.innerText = improvedText;
    //// console.log("in undo improved", improvedText);
    displayResponse(improvedText, false);
    isUndo = false;
    document.querySelector(".action-button").innerHTML = `
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="9.99996" cy="9.99984" r="8.33333" stroke="#ffff" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M13.3333 7.9165H14.0833C14.0833 7.50229 13.7475 7.1665 13.3333 7.1665V7.9165ZM14.0833 14.1665V7.9165H12.5833V14.1665H14.0833ZM6.66663 8.6665H13.3333V7.1665H6.66663V8.6665Z" fill="#ffff"/>
          <path d="M8.74996 5.83301L6.66663 7.91634L8.74996 9.99967" stroke="#ffff" stroke-width="1.5"/>
        </svg>
        <span>Oprindelig tekst</span>
      `;
  }
  // ! handle undo
  adjustInputTextareaHeight();
}
// Function to improve text using saved prompt
function improveText(improvementPrompt) {
  showLoader(".textarea-wrapper", "Forbedre teksten...");
  let textToSend = removeMarkTags(removeHamDanTags(takeCurrentText()));
  const formData = new FormData();
  formData.append("action", "improve_text_style_grammer_v2");
  formData.append("text", textToSend);
  formData.append("prompt", improvementPrompt);
  formData.append("language", currentLanguage);

  //// console.log("\n============================== Data sending to improve call ================================\n")
  //// console.log("text sending:\n", originalContent.html);
  //// console.log("Improvement prompt sending:\n", improvementPrompt);
  //// console.log("language sending:\n", currentLanguage);
  fetch(SB_ajax_object.ajax_url, {
    method: "POST",
    credentials: "same-origin",
    body: new URLSearchParams(formData),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        const content = data.data.improved_text;
        const removeRegex = content.replace(/\\/g, "");
        displayResponse(removeRegex);
        onResponseGenerated(removeRegex);
        // Adjust heights after content change
        improvedText = removeRegex;

        // adjustHeights();
      } else {
        throw new Error(data.data?.message || "Text improvement failed");
      }
    })
    .catch((error) => {
      console.error("Text improvement failed:", error);
      alert("Failed to improve text. Please try again.");
    })
    .finally(() => {
      hideLoader(".textarea-wrapper");
    });
}

// ==================================================== text switcher function ===============================================================

function textSwitcher() {
  if (isMainSwtich) {
    switcherText = takeCurrentText();
    quill1.root.innerHTML = originalContent.html;

    isMainSwtich = false;
  } else {
    quill1.root.innerHTML = switcherText; // ✅ Injects HTML into the editor
    isMainSwtich = true;
  }

  // Trigger input event for any other listeners
  adjustInputTextareaHeight();
}
mainSwitcher.addEventListener("click", textSwitcher);

// ============================================= handle copy ========================================

// =========================================================== Function to get all saved responses ===========================================================

// ========================================================== rewrote model code ===========================================================
// const rewriteDivs = document.querySelectorAll(".rewrite-model-div");

let rewriteIndex = 0;
const rewriteNavDiv = document.querySelector(".response-navigation");
const counterNav = document.querySelector(".counter-nav-div");

document.querySelector("#rewriteBtn").addEventListener("click", () => {
  // //// console.log("clicked the rewrite button")

  clearHighlights();
  dkHamdanOpenModal(0);
});

// =========================================== rewrite modal ==========================================
// Function to open the modal
function dkHamdanOpenModal(index) {
  // //// console.log("object index", index);

  const modal = document.querySelector(".dk-hamdan-modal-container");
  modal.style.display = "block";
  modal.style.position = "fixed";
  modal.style.top = "50%";
  modal.style.left = "50%";
  modal.style.transform = "translate(-50%, -50%)";
  modal.style.zIndex = "1000";

  // Add overlay to capture outside clicks
  const overlay = document.createElement("div");
  overlay.className = "dk-hamdan-modal-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100vw";
  overlay.style.height = "100vh";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  overlay.style.zIndex = "999";
  document.body.appendChild(overlay);

  document.getElementById("custom_rewrite_input").value = "";
  // Close modal when clicking outside
  overlay.addEventListener("click", dkHamdanCloseModal);

  // Hide sidebar by changing its z-index
  const sidebar = document.querySelector(sidebarSelector);
  if (sidebar) {
    originalZIndex = window.getComputedStyle(sidebar).zIndex;
    sidebar.style.zIndex = "1";
  }
  toggleClearIcon(document.getElementById("custom_rewrite_input"));
}

// Function to close the modal
function dkHamdanCloseModal() {
  const modal = document.querySelector(".dk-hamdan-modal-container");
  const overlay = document.querySelector(".dk-hamdan-modal-overlay");
  modal.style.display = "none";
  if (overlay) {
    document.body.removeChild(overlay);
  }
  // Restore sidebar's original z-index
  const sidebar = document.querySelector(sidebarSelector);
  if (sidebar) {
    sidebar.style.zIndex = originalZIndex;
  }

  manuallyCloseMicButton("micButton2");
}

// Attach the close function to the close button inside the modal
document
  .querySelector(".dk-hamdan-close-button")
  .addEventListener("click", dkHamdanCloseModal);

// function shows the icon in the input field
function toggleClearIcon(input) {
  const icon = input.nextElementSibling; // Select the clear icon
  if (input.value.trim() !== "") {
    icon.style.display = "inline"; // Show icon
  } else {
    icon.style.display = "none"; // Hide icon
  }
}

let dkHamdanInputText = "";
//  funciton on the click of the input prompt it wil be called
document
  .getElementById("submint_rewrite")
  .addEventListener("click", inputRewritecall);
function inputRewritecall() {
  dkHamdanInputText = document.getElementById("custom_rewrite_input").value;
}

// Global state for tracking responses and current paragraph
let rewriteResponses = {};
let currentParagraphIndex = 0;

// Add event listeners for rewrite buttons
document
  .getElementById("convencing")
  .addEventListener("click", () => handleRewrite("convencing"));
document
  .getElementById("simplify")
  .addEventListener("click", () => handleRewrite("simplify"));
document
  .getElementById("elaborate")
  .addEventListener("click", () => handleRewrite("elaborate"));
document
  .getElementById("concise")
  .addEventListener("click", () => handleRewrite("concise"));

// Handle rewrite button clicks
function handleRewrite(buttonId) {
  // //// console.log(`Rewrite button clicked: ${buttonId} `);

  // //// console.log('Sending rewrite request...');
  sendRewriteRequest(buttonId);
  dkHamdanCloseModal();
}

// Add navigation event listeners
document.querySelector(".arrow-left").addEventListener("click", () => {
  // //// console.log('Navigating to previous response...');
  navigateResponses("prev");
});

document.querySelector(".arrow-right").addEventListener("click", () => {
  // //// console.log('Navigating to next response...');
  navigateResponses("next");
});

// Navigate through responses

function navigateResponses(direction) {
  const counter = document.querySelector(".response-counter");
  const matches = counter.textContent.match(/\d+/g);
  const [current, total] = matches
    ? matches.map((num) => parseInt(num))
    : [0, 0];

  if (direction === "prev" && current > 1) {
    updateContent(current - 2);
  } else if (direction === "next" && current < total) {
    updateContent(current);
  }
}

function updateContent(responseIndex) {
  // //// console.log(`Updating content to response index: ${responseIndex}`);
  const textarea = document.getElementById("inputText");

  // Ensure rewriteResponses exists for current paragraph
  if (!rewriteResponses[currentParagraphIndex]) {
    rewriteResponses[currentParagraphIndex] = {
      responses: [],
    };
  }

  const responses = rewriteResponses[currentParagraphIndex].responses;

  if (responses && responses[responseIndex]) {
    // textarea.innerHTML = responses[responseIndex];
    // textarea.textContent = responses[responseIndex]; // For non-input textareas
    displayResponse(responses[responseIndex]);
    adjustHeights();
    // Update counter
    const counter = document.querySelector(".response-counter");
    counter.textContent = `Tekst ${responseIndex + 1} ud af ${
      responses.length
    }`;

    // //// console.log('Content and counter updated successfully');
  } else {
    console.warn("Response not found for index:", responseIndex);
  }
}

function resetNavText() {
  rewriteNavDiv.style.display = "none";
  rewriteResponses = {};
  counterNav.style.justifyContent = "center";
  const counter = document.querySelector(".response-counter");
  counter.textContent = `Tekst 1 ud af 1`;
}
function showNavigation() {
  rewriteNavDiv.style.display = "flex";
  counterNav.style.display = "flex";
  counterNav.style.justifyContent = "flex-start";
  document.querySelector(".correction-options").style.marginTop = "1.5rem";
}

function sendRewriteRequest(buttonId) {
  // //// console.log(`Sending rewrite request with buttonId: ${buttonId}`);

  currentText = originalContent.html;
  //// console.log("Text sending to rewrite\n", currentText)

  showLoader(".textarea-wrapper", "Omskriver teksten...");

  if (!rewriteResponses[currentParagraphIndex]) {
    rewriteResponses[currentParagraphIndex] = {
      responses: [currentText],
    };
    // //// console.log('Initialized response storage for the current paragraph index.');
  }

  const formData = new FormData();
  formData.append("action", "rewrite_grammer_bot_v2");
  formData.append("current_text", currentText);
  let langForRewrite =
    Object.keys(languageMap).find(
      (key) => languageMap[key] === currentLanguage
    ) || currentLanguage;
  // //// console.log("languague for rewrite", langForRewrite)
  formData.append("language", langForRewrite);
  switch (buttonId) {
    case "convencing":
      formData.append("prompt_index", "0");
      break;
    case "simplify":
      formData.append("prompt_index", "1");
      break;
    case "elaborate":
      formData.append("prompt_index", "2");
      break;
    case "concise":
      formData.append("prompt_index", "3");
      break;
  }

  const customInput = document.getElementById("custom_rewrite_input");
  if (customInput?.value) {
    formData.append("rewrite_prompt", customInput.value);
    // //// console.log('Custom rewrite prompt provided:', customInput.value);
  }

  for (var pair of formData.entries()) {
    // //// console.log(pair[0] + ', ' + pair[1]);
  }

  fetch(sac_ajax_object.ajax_url, {
    method: "POST",
    credentials: "same-origin",
    body: new URLSearchParams(formData),
  })
    .then((response) => {
      // //// console.log('Server response received.');
      return response.text();
    })
    .then((text) => {
      // //// console.log('Response text:', text);
      try {
        return JSON.parse(text);
      } catch (error) {
        console.error("Failed to parse response:", error);
        throw new Error("Invalid response format");
      }
    })
    .then((data) => {
      // //// console.log('Parsed response data:', data);
      if (data.success) {
        const content = data.data;
        // console.log("rewrite content:\n", content);
        const removeRegex = content.replace(/\\/g, "");
        // console.log("rewrite content after regex:\n", content);
        displayResponse(removeRegex);
        onResponseGenerated(removeRegex);
        showNavigation();
        // Store response and update counter
        rewriteResponses[currentParagraphIndex].responses.push(content);
        const responseCount =
          rewriteResponses[currentParagraphIndex].responses.length;
        document.querySelector(
          ".response-counter"
        ).textContent = `Tekst ${responseCount} ud af ${responseCount}`;
        // document.getElementById('correctionOptions').style.display = 'flex';
        // //// console.log('Rewrite successful. Updated corrections display and counter.');
      } else {
        console.error("Error:", data.data?.message || "Unknown error");
      }
    })
    .catch((error) => {
      console.error("Request failed:", error);
    })
    .finally(() => {
      hideLoader(".textarea-wrapper");
      // //// console.log('Request completed.');
    });
}

// Handle custom rewrite input
document.getElementById("submint_rewrite")?.addEventListener("click", () => {
  // //// console.log('Custom rewrite submitted.');
  handleRewrite("custom");
});

// ========================================== Revert back btn ===============================================
document.querySelector("#revertBack").addEventListener("click", (e) => {
  e.preventDefault();
  quill1.history.undo();
});

// ========================================== Forward btn ===============================================
document.querySelector("#forwardButton").addEventListener("click", (e) => {
  e.preventDefault();
  quill1.history.redo();
});

// ----------------------------- adjust heigts ========================================================
// Add mobile detection

// Flag to determine if we need special scroll handling
function adjustInputTextareaHeight(
  element = document.getElementById("inputText")
) {
  // Save scroll position for mobile or Safari
  element = element || document.getElementById("inputText");
  const scrollTop = needsScrollHandling
    ? window.pageYOffset || document.documentElement.scrollTop
    : 0;

  // Restore scroll position on mobile or Safari
  if (needsScrollHandling) {
    setTimeout(() => {
      window.scrollTo(0, scrollTop);
    }, 10);
  }

  adjustHeights();
}

// SIMPLIFIED height adjustment function - NO debounce, NO MutationObserver
function adjustHeights() {
  // // console.log("adjustHeights() function called");

  const textAreaContainer = document.querySelector(".text-area-container");
  const mainTextAreaSection = document.querySelector(".main-textarea-section");
  const correctionSidebar = document.querySelector(".correction-sidebar");
  const editor = document.querySelector(".ql-editor");
  const topControls = document.querySelector(".top-controls");
  const headerSection = document.querySelector(".header-section");
  const styleInner = document.querySelector(".style-inner");

  if (!textAreaContainer || !mainTextAreaSection) {
    console.error("Required container elements are missing");
    return;
  }

  // Set minimum height
  const minHeight = 420;

  // Get heights of fixed elements
  const topControlsHeight = topControls ? topControls.offsetHeight : 0;
  const headerHeight = headerSection ? headerSection.offsetHeight : 0;

  // Calculate editor content height
  let editorContentHeight = minHeight;
  if (editor) {
    // Temporarily set height to auto to get accurate scroll height
    const originalHeight = editor.style.height;
    const originalOverflow = editor.style.overflowY;

    editor.style.height = "auto";
    editor.style.overflowY = "hidden";

    editorContentHeight = Math.max(
      editor.scrollHeight + topControlsHeight,
      minHeight
    );

    // Restore original styles
    editor.style.height = originalHeight;
    editor.style.overflowY = originalOverflow;
  }

  // Calculate style-inner content height if visible
  let styleInnerContentHeight = 0;
  let styleInnerTotalHeight = minHeight;

  if (styleInner && window.getComputedStyle(styleInner).display !== "none") {
    // Temporarily remove constraints to measure natural height
    const originalStyleHeight = styleInner.style.height;
    const originalStyleOverflow = styleInner.style.overflowY;

    styleInner.style.height = "auto";
    styleInner.style.overflowY = "visible";

    // Get the natural content height
    styleInnerContentHeight = styleInner.scrollHeight;
    styleInnerTotalHeight = Math.max(
      styleInnerContentHeight + headerHeight,
      minHeight
    );

    // Restore original styles temporarily
    styleInner.style.height = originalStyleHeight;
    styleInner.style.overflowY = originalStyleOverflow;

    // // console.log("Height comparison:", {
    //     editorContentHeight: editorContentHeight,
    //     styleInnerContentHeight: styleInnerContentHeight,
    //     styleInnerTotalHeight: styleInnerTotalHeight
    // });
  }

  // MAIN LOGIC: Compare heights and decide final height
  let finalHeight = Math.max(
    editorContentHeight,
    styleInnerTotalHeight,
    minHeight
  );

  // Apply the final height to all containers
  // textAreaContainer.style.height = `${finalHeight}px`;
  // mainTextAreaSection.style.height = `${finalHeight}px`;

  // if (correctionSidebar) {
  //   correctionSidebar.style.height = `${finalHeight}px`;
  // }

  // Handle style-inner specifically
  // if (styleInner && window.getComputedStyle(styleInner).display !== "none") {
  //   const availableHeight = finalHeight - headerHeight;
  //   styleInner.style.height = `${availableHeight}px`;
  // }

  // Handle other sidebar sections (improv-inner, correction-inner)
  const improvInner = document.querySelector(".improv-inner");
  const correctionInner = document.querySelector(".correction-inner");
  const correctionContent = document.querySelector(".correction-content");

  if (improvInner && window.getComputedStyle(improvInner).display !== "none") {
    const availableHeight = finalHeight - headerHeight;
    improvInner.style.height = `${availableHeight}px`;

    if (correctionContent) {
      correctionContent.style.height = `${availableHeight}px`;
    }
  }

  if (
    correctionInner &&
    window.getComputedStyle(correctionInner).display !== "none"
  ) {
    const availableHeight = finalHeight - headerHeight;
    correctionInner.style.height = `${availableHeight}px`;

    const correctionInnerMain = document.querySelector(
      ".correction-inner-main"
    );
    if (correctionInnerMain) {
      correctionInnerMain.style.height = `${availableHeight}px`;
    }
  }

  // // console.log("Final heights applied:", {
  //     finalHeight: finalHeight,
  //     editorWasTaller: editorContentHeight >= styleInnerTotalHeight,
  //     styleInnerOverflow: styleInner ? styleInner.style.overflowY : 'N/A'
  // });
}

// Simple event listeners - NO debounce, NO MutationObserver
document.addEventListener("DOMContentLoaded", function () {
  // Initial height adjustment
  setTimeout(adjustHeights, 100);

  // Get or initialize Quill instance
  let quill;

  // Check if Quill is already initialized
  const editorElement = document.querySelector(".ql-editor");
  if (editorElement && editorElement.__quill) {
    quill = editorElement.__quill;
  } else if (window.quill) {
    quill = window.quill;
  }

  // Listen for Quill text changes
  if (quill) {
    quill.on("text-change", function () {
      // Small delay to let Quill finish updating
      setTimeout(adjustHeights, 10);
    });
  }

  // Fallback event listeners for the editor element
  if (editorElement) {
    // Key events that change structure
    editorElement.addEventListener("keyup", function (e) {
      if (["Enter", "Backspace", "Delete", "Tab"].includes(e.key)) {
        setTimeout(adjustHeights, 10);
      }
    });

    // Paste events
    editorElement.addEventListener("paste", function () {
      setTimeout(adjustHeights, 50);
    });

    // Input events as fallback
    editorElement.addEventListener("input", function () {
      setTimeout(adjustHeights, 10);
    });
  }

  // Window resize
  window.addEventListener("resize", function () {
    setTimeout(adjustHeights, 50);
  });
});

// Utility function to trigger height adjustment from external code
function syncContentHeights() {
  // // console.log("syncContentHeights() called");
  adjustHeights();
}

// Function to manually trigger height adjustment
function forceHeightAdjustment() {
  setTimeout(adjustHeights, 10);
}

// Make functions available globally
window.adjustHeights = adjustHeights;
window.syncContentHeights = syncContentHeights;
window.forceHeightAdjustment = forceHeightAdjustment;

// Force initial adjustment after everything loads
window.addEventListener("load", function () {
  setTimeout(adjustHeights, 100);
});

// ------------------------------------- handle clear button ----------------------------
// Function to update clear button state
// ========================================== Update button states ===============================================
function updateClearRevertButtonState(flag = "center") {
  // Handle explicit enable/disable flags
  if (flag === "false") {
    revertFun.disabled = false;
    forwardFun.disabled = false;
    clearButton.disabled = false;
    return;
  }
  if (flag === "true") {
    revertFun.disabled = true;
    forwardFun.disabled = true;
    clearButton.disabled = true;
    return;
  }

  // Default behavior: Update based on editor content and history
  const hasContent = quill1.getText().trim().length > 0;
  const history = quill1.history;

  clearButton.disabled = !hasContent; // Clear button enabled if there's content
  revertFun.disabled = !history.stack.undo.length; // Undo enabled if there are undoable actions
  forwardFun.disabled = !history.stack.redo.length; // Redo enabled if there are redoable actions
}

// Update button states whenever the editor content changes
quill1.on("text-change", updateButtonStates);

// Initial update to set correct button states
updateButtonStates();

// Wrapper function to ensure compatibility with existing calls
function updateButtonStates() {
  updateClearRevertButtonState();
}
// Function to handle clear operation
function handleClear() {
  stopSpeaking();
  quill1.setContents([]);
  // Refocus editor
  manuallyCloseMicButton("micButton1");
  quill1.focus();
  // Manually trigger events if needed
  quill1.root.dispatchEvent(new Event("input"));

  // Save scroll position for mobile or Safari
  resetNavText();
  const scrollTop = needsScrollHandling
    ? window.pageYOffset || document.documentElement.scrollTop
    : 0;
  const correctionOpts = document.getElementById("correctionOptions");
  correctionOpts.style.display = "none";

  resetSidebar();
  lastCorrectedText = "";
  // Force placeholder update
  updatePlaceholder(getLanguageName(currentLanguage));
  // updateSelectedOption(dropdownOptions[0]);
  // Update other UI elements

  adjustInputTextareaHeight();
  if (typeof updateGenerateButtonState === "function") {
    updateGenerateButtonState();
  }
  document.querySelector("#mainSwitcher").disabled = true;
  isMainSwtich = true;
  switcherText = "";
  isUndo = false;
  noOfChanges = -1;
  originalContent.html = "";
  originalContent.text = "";

  // Restore scroll position on mobile or Safari
  if (needsScrollHandling) {
    setTimeout(() => {
      window.scrollTo(0, scrollTop);
    }, 10);
  }
  updateClearRevertButtonState();
}
// Add click event listener to clear button
clearButton.addEventListener("click", handleClear);

quill1.on("text-change", updateClearRevertButtonState);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Delete") {
    e.preventDefault();
    handleClear();
  }
});

// Initial call to set correct state
updateClearRevertButtonState();

// !---------------------------------------- sipliting code --------------------------------
function getTextLength(html) {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  return tempDiv.textContent.trim().length;
}

function findTextPositionInHtml(html, targetTextLength) {
  let currentTextLength = 0;
  let htmlPosition = 0;
  const tempDiv = document.createElement("div");

  // Walk through HTML character by character
  while (htmlPosition < html.length && currentTextLength < targetTextLength) {
    tempDiv.innerHTML = html.substring(0, htmlPosition + 1);
    const newTextLength = tempDiv.textContent.trim().length;

    if (newTextLength >= targetTextLength) {
      // Find a safe break point near here
      for (
        let i = htmlPosition;
        i < Math.min(html.length, htmlPosition + 100);
        i++
      ) {
        if (html[i] === ">" && i + 1 < html.length) {
          return i + 1;
        }
      }
      return htmlPosition;
    }

    htmlPosition++;
    currentTextLength = newTextLength;
  }

  return htmlPosition;
}

/* ─────────────────────────── robust splitter ────────────────────────────
   - Split an HTML string into 1-5 nearly-even parts **without** cutting
     through "atomic" blocks such as lists and tables.                     */
function robustHtmlDivider(htmlContent, maxLength = 500, targetSplits = 2) {
  /* ---------- helpers ---------- */
  const getTextLen = (node) => node.textContent.length;
  const serialise = (nodes, start, end) =>
    nodes
      .slice(start, end)
      .map((n) => n.outerHTML ?? n.textContent)
      .join("")
      .trim();

  /* ---------- quick exit ---------- */
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, "text/html");
  const body = doc.body;
  const nodes = Array.from(body.childNodes);
  const total = getTextLen(body);

  if (total <= maxLength || targetSplits === 1) return [htmlContent];

  /* ---------- choose safe boundaries ---------- */
  const atomic = new Set([
    "UL",
    "OL",
    "TABLE",
    "THEAD",
    "TBODY",
    "TFOOT",
    "TR",
    "BLOCKQUOTE",
    "SECTION",
    "ARTICLE",
    "HEADER",
    "FOOTER",
    "NAV",
    "ASIDE",
    "MAIN",
  ]);

  /* build cumulative text-lengths once */
  const cum = [];
  nodes.reduce((sum, n, i) => ((cum[i] = sum + getTextLen(n)), cum[i]), 0);

  /* ideal breakpoints: ⅓, ⅔, ¼,½,¾, etc. */
  const ideals = [];
  for (let i = 1; i < targetSplits; i++) {
    ideals.push((total * i) / targetSplits);
  }

  const taken = new Set();
  const cuts = [];

  /** find node boundary closest to `ideal`, skipping atomic blocks */
  const boundaryFor = (ideal) => {
    let bestIdx = -1,
      bestDist = Infinity;
    for (let i = 0; i < cum.length; i++) {
      if (taken.has(i)) continue;
      if (atomic.has(nodes[i].nodeName)) continue; // don't cut list/table itself
      const dist = Math.abs(cum[i] - ideal);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) taken.add(bestIdx);
    return bestIdx;
  };

  /* pick boundaries */
  for (const ideal of ideals) {
    const idx = boundaryFor(ideal);
    if (idx !== -1) cuts.push(idx);
  }
  cuts.sort((a, b) => a - b);

  /* sanity check – if we didn't manage to find enough boundaries,
       fall back to a simple no-split behaviour */
  if (cuts.length !== ideals.length) return [htmlContent];

  /* ---------- build parts ---------- */
  const parts = [];
  let prev = 0;
  for (const cut of cuts) {
    parts.push(serialise(nodes, prev, cut + 1));
    prev = cut + 1;
  }
  parts.push(serialise(nodes, prev, nodes.length));
  return parts;
}

/* ─────────────────────── generic fallback splitter ───────────────────────
   – only used if robustHtmlDividerThrows or returns the entire HTML */
function characterBasedSplit(htmlContent, pieces) {
  const totalTextLength = getTextLength(htmlContent);
  const approxPerPiece = totalTextLength / pieces;
  const result = [];
  let start = 0;

  for (let p = 1; p < pieces; p++) {
    const target = approxPerPiece * p;
    const breakPoint = findTextPositionInHtml(htmlContent, target);
    result.push(htmlContent.substring(start, breakPoint).trim());
    start = breakPoint;
  }
  result.push(htmlContent.substring(start).trim());
  return result;
}

/* ──────────────────────── top-level orchestrator ──────────────────────── */

function processComplexHtml(htmlContent, maxLength = 500) {
  // 1) optional cleaning (leave unchanged)
  const cleaned =
    typeof convertBulletListToUl === "function" &&
    typeof removeHamDanTags === "function"
      ? convertBulletListToUl(removeHamDanTags(htmlContent))
      : htmlContent;

  const len = getTextLength(cleaned);

  /* 2) decide split count –- UPDATED ------------- */
  let splits;
  if (len <= 500) splits = 1; // ≤ 500
  else if (len < 1500) splits = 2; // 501 – 1 499
  else if (len < 2500) splits = 3; // 1 500 – 2 499
  else if (len < 3500) splits = 4; // 2 500 – 3 499
  else if (len < 4500) splits = 5; // 3 500 – 4 499
  else splits = 6; // ≥ 4 500

  /* 3) try the robust splitter (unchanged) */
  try {
    const pieces = robustHtmlDivider(cleaned, maxLength, splits);
    if (pieces.length === 1 && splits > 1) {
      console.warn(
        "⚠️ robustHtmlDivider could not split; using character fallback"
      );
      // return characterBasedSplit(cleaned, splits);
      return [cleaned];
    }
    return pieces;
  } catch (err) {
    console.error("robustHtmlDivider crashed:", err);
    // return characterBasedSplit(cleaned, splits);
    return [cleaned];
  }
}

/* Keep/getTextLength, findTextPositionInHtml, convertBulletListToUl,
   removeHamDanTags, etc. exactly as you already have them.               */

// Export (optional, if you need them globally)
window.robustHtmlDivider = robustHtmlDivider;
window.processComplexHtml = processComplexHtml;

// ---------------------------- removing headings to strong tag ---------------------------------------
function convertHeadingsToStrong(html) {
  // This regex matches:
  //  1. <(h[1-6])[^>]*>   → an opening tag <h1>–<h6> (with any attributes)
  //  2. ([\s\S]*?)       → lazily captures everything inside (including newlines)
  //  3. </\1>            → the corresponding closing tag (e.g. </h3> if <h3> was matched)
  //
  // The 'gi' flags mean global (replace all) and case-insensitive (so <H2> also matches).
  return html.replace(
    /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi,
    "<strong>$2</strong>"
  );
}
// ---------------------------------------- parallel api requests ----------------------------------------
const grammerApiParallel = async (type, partsArray) => {
  // console.log(`Making parallel ${type} request with ${partsArray.length} parts`);
  // console.log('partsArray:', partsArray.lenght, partsArray);
  const data = {
    action: "korrektur_grammar_parallel_v1",
    type: type,
    parts: JSON.stringify(partsArray),
  };

  try {
    const response = await fetch(SB_ajax_object.ajax_url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;",
      },
      body: new URLSearchParams(data).toString(),
    });

    const responseData = await response.json();

    if (responseData.success) {
      // console.log("grammerApiParallel success \n", responseData.data);
      return responseData.data;
    } else {
      throw new Error(responseData.data || "Parallel API request failed");
    }
  } catch (error) {
    console.error(`Error in parallel ${type} call:`, error);
    throw error;
  }
};

const formatCallingParallel = async (language, parts) => {
  // console.log("printing the formatCallingparts \n", parts);
  const data = {
    action: "formatting_call_parallel",
    language: language,
    parts: JSON.stringify(parts),
  };

  try {
    const response = await fetch(SB_ajax_object.ajax_url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;",
      },
      body: new URLSearchParams(data).toString(),
    });

    const responseData = await response.json();

    if (responseData.success) {
      // console.log("formatCallingParallel success \n", responseData.data);
      return responseData.data;
    } else {
      throw new Error(
        responseData.data?.message || "Parallel formatting request failed"
      );
    }
  } catch (error) {
    console.error("Error in parallel formatting call:", error);
    throw error;
  }
};

function combineFormattingResults(results) {
  return results
    .map((result) => {
      let cleaned = result.replace(/\\/g, "");
      cleaned = cleaned.replace(/```html|```HTML/g, "");
      cleaned = cleaned.replace(/```/g, "");
      return cleaned.trim();
    })
    .join("\n\n");
}

// ---------------------------------- for the explanation this is code ----------------------------------

function prepareExplanationParts(htmlParts) {
  // console.log(`Preparing explanation parts for ${htmlParts.length} sections`);

  // Plain text version of each original HTML slice
  const originalTextParts = htmlParts.map((part) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = part;
    return htmlToTextWithSpacing(tmp.innerHTML);
  });

  const explanationParts = [];

  htmlParts.forEach((_, index) => {
    const partOriginal = originalTextParts[index] || "";
    const partCorrected = correctedResults[index] || "";
    const partDiffHTML = diffHTMLParts[index] || "";

    const spanList = partDiffHTML ? collectSpanTags(partDiffHTML) : [];
    const changeCount = spanList.length;
    // console.log(`Part ${index} has ${changeCount} changes`);
    if (changeCount > 0) {
      explanationParts.push({
        original: partOriginal,
        corrected: partCorrected,
        noOfChanges: changeCount.toString(),
        grammarClasses: JSON.stringify(spanList),
      });
    }
  });

  // console.log('Prepared explanation parts:', explanationParts);
  return explanationParts;
}

// Helper function to convert diff HTML to corrected text
function convertDiffHTMLToText(diffHTML) {
  if (!diffHTML) return "";

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = diffHTML;

  // Remove elements with grammar-correction-removed class
  tempDiv
    .querySelectorAll(".grammar-correction-removed")
    .forEach((el) => el.remove());

  // Clean up the remaining text
  return tempDiv.textContent || tempDiv.innerText || "";
}

// Helper function to combine explanation results
function combineExplanationResults(results) {
  if (!results || results.length === 0) return "";
  if (results.length === 1) return results[0];

  // console.log("Combining explanation results:", results);

  try {
    // Parse each result and combine explanations
    const allExplanations = [];

    results.forEach((result, index) => {
      // console.log(`Processing explanation result ${index}:`, result);

      const parsedExplanations = processExplanations(result);
      if (parsedExplanations && parsedExplanations.length > 0) {
        allExplanations.push(...parsedExplanations);
      }
    });

    // Create combined result in the expected format
    const combinedResult = {
      explanations: allExplanations,
    };

    // console.log("Combined explanations result:", combinedResult);

    // Return as JSON string to match the expected format
    return JSON.stringify(combinedResult);
  } catch (error) {
    console.error("Error combining explanation results:", error);
    return results.join(" ");
  }
}
// Fallback function for single explanation call
function fallbackToSingleExplanation() {
  // console.log("Falling back to single explanation call");

  let spanList = collectSpanTags(diffHTMLExp);
  // console.log("Fallback span tag list ", spanList);

  grammerApi("explanations", {
    original: originalContent.text,
    corrected: correctedText,
    noOfChanges: noOfChanges.toString(),
    grammarClasses: JSON.stringify(spanList),
  })
    .then((explanationResults) => {
      isExplanations = true;
      processGrammarExplanations(explanationResults);
      hideLoader(".correction-message");
      analyseLoader(false); // ✅ Hide after fallback completes
    })
    .catch((error) => {
      console.error("Fallback Explanation API Error:", error);
      handleExplanationError();
    });
}

// Helper function to handle explanation errors
function handleExplanationError() {
  const sidebarContent = document.querySelector(".correction-content");
  if (sidebarContent) {
    if (sidebarContent.classList.contains("has-explanations")) {
      sidebarContent.classList.remove("has-explanations");
    }
    sidebarContent.innerHTML = `
            <div class="correction-message">
                <span style="color:#FF5555">Der opstod en fejl ved behandling af forklaringer.</span>
            </div>
        `;
  }
  hideLoader(".correction-message");
  analyseLoader(false); // ✅ Hide on error
}

function removeHamDanTags(htmlContent) {
  if (!htmlContent || typeof htmlContent !== "string") {
    return htmlContent;
  }

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlContent;

  // Select every <ham-dan> element once, snapshotting into an array so we can modify safely
  Array.from(tempDiv.querySelectorAll("ham-dan")).forEach((hamDan) => {
    if (hamDan.classList.contains("grammar-correction-removed")) {
      // ① If it's marked for removal, drop the entire element (and anything inside it)
      hamDan.remove();
    } else {
      // ② Otherwise unwrap it, preserving its children
      const fragment = document.createDocumentFragment();
      while (hamDan.firstChild) {
        fragment.appendChild(hamDan.firstChild);
      }
      hamDan.replaceWith(fragment);
    }
  });

  return tempDiv.innerHTML;
}
function removeMarkTags(htmlContent) {
  if (!htmlContent || typeof htmlContent !== "string") {
    return htmlContent;
  }

  // Work in a detached DOM tree
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlContent;

  // Snapshot the list first so we can mutate safely while iterating
  Array.from(tempDiv.querySelectorAll("mark")).forEach((markEl) => {
    const fragment = document.createDocumentFragment();
    while (markEl.firstChild) {
      fragment.appendChild(markEl.firstChild);
    }
    markEl.replaceWith(fragment); // unwrap <mark>, keep its children
  });

  return tempDiv.innerHTML;
}

function convertStrongParagraphsToHeadings(htmlInput) {
  // 1. Normalise input into a temporary container we can mutate safely
  const container = document.createElement("div");

  if (typeof htmlInput === "string") {
    container.innerHTML = htmlInput;
  } else if (htmlInput instanceof Node) {
    container.appendChild(htmlInput.cloneNode(true)); // work on a copy, stay side-effect-free
  } else {
    throw new TypeError(
      "convertStrongParagraphsToHeadings expects an HTML string or a DOM node"
    );
  }

  // 2. Walk over every <p> inside the container
  container.querySelectorAll("p").forEach((p) => {
    // Ignore whitespace-only text nodes
    const meaningfulChildren = Array.from(p.childNodes).filter(
      (n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim())
    );

    // Our conversion rule: exactly one child and it must be <strong>
    if (
      meaningfulChildren.length === 1 &&
      meaningfulChildren[0].nodeType === Node.ELEMENT_NODE &&
      meaningfulChildren[0].tagName === "STRONG"
    ) {
      const strong = meaningfulChildren[0];
      const h1 = document.createElement("h1");

      // Copy the innerHTML of <strong> into the new <h1>
      h1.innerHTML = strong.innerHTML;

      // (Optional) migrate any inline attributes from <strong> → <h1>
      // for (const { name, value } of Array.from(strong.attributes)) h1.setAttribute(name, value);

      // Swap the original <p> with the new <h1>
      p.replaceWith(h1);
    }
  });

  // 3. Return the final HTML markup
  return container.innerHTML;
}

function convertBulletListToUl(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  const olElements = [...doc.querySelectorAll("ol")];

  olElements.forEach((ol) => {
    const ul = document.createElement("ul");
    let liMoved = false;

    [...ol.children].forEach((li) => {
      const dataList = li.getAttribute("data-list");
      if (dataList === "bullet") {
        li.removeAttribute("data-list");
        ul.appendChild(li.cloneNode(true));
        li.remove();
        liMoved = true;
      }
    });

    if (liMoved) {
      // If all lis were bullets, just replace the entire ol
      if (ol.children.length === 0) {
        ol.replaceWith(ul);
      } else {
        // Otherwise, insert ul before ol and keep ol for numbered items
        ol.parentNode.insertBefore(ul, ol);
      }
    }
  });

  return doc.body.innerHTML;
}

//-------------------------------------- Handle paste code --------------------------------------
const pasteButton = document.querySelector("#pasteBtn");

async function handlePaste(clearExisting = false, moveToEnd = true) {
  stopSpeaking();
  manuallyCloseMicButton("micButton1");
  // handleClear();
  resetNavText();
  // console.log('handlePaste function called, clearExisting:', clearExisting);

  try {
    /* ──────────────────── (1) optional editor clear ──────────────────── */
    if (clearExisting) {
      // console.log('Clearing the editor…');
      quill1.setText("");
      resetSidebar();
      handleClear();
    }

    let html = null;
    let text = "";

    /* ──────────────────── (2) read clipboard items ──────────────────── */
    if (navigator.clipboard.read) {
      try {
        const items = await navigator.clipboard.read();
        // console.log('Clipboard items found:', items.length);

        let processedContent = false;

        for (const item of items) {
          // skip pure image blobs
          if (
            item.types.some(
              (t) => t.startsWith("image/") && !t.includes("docs")
            ) &&
            item.types.length === 1
          ) {
            // console.log('Skipping image file:', item.types);
            continue;
          }

          /* ───── HTML branch ───── */
          if (item.types.includes("text/html")) {
            const blob = await item.getType("text/html");
            const htmlText = await blob.text();
            // console.log('%c[Original Pasted HTML]:', 'color: blue; font-weight: bold;', htmlText);

            // Thorough clean-up (images, background images, SVG, <picture>, base64)
            const cleanedHTML = htmlText
              .replace(/<img[^>]*>/gi, "")
              .replace(/background-image\s*:\s*url\([^)]+\)/gi, "")
              .replace(/<svg[^>]*>.*?<\/svg>/gis, "")
              .replace(/<picture[^>]*>.*?<\/picture>/gis, "")
              .replace(/data:image\/[^;]+;base64,[^\s'"]+/gi, "");

            // console.log('%c[Cleaned HTML for insertion]:', 'color: green; font-weight: bold;', cleanedHTML);

            const isEmpty = quill1.getText().trim().length === 0;
            const selection = quill1.getSelection();
            const insertIndex = selection
              ? selection.index
              : quill1.getLength();
            const selectionLength = selection ? selection.length : 0;

            // delete current selection if any
            if (selectionLength > 0) {
              quill1.deleteText(insertIndex, selectionLength);
            }

            if (cleanedHTML.trim()) {
              if (isEmpty) {
                // wipe Quill's auto-<p><br></p>
                if (quill1.root.innerHTML === "<p><br></p>") quill1.setText("");

                quill1.clipboard.dangerouslyPasteHTML(0, cleanedHTML, "user");

                // FIXED: Calculate correct cursor position for empty editor
                const newLength = quill1.getLength();
                quill1.setSelection(newLength - 1, 0);
              } else {
                const pasteIndex = selection
                  ? selection.index
                  : quill1.getLength();

                // Store the length before pasting to calculate the pasted content length
                const lengthBeforePaste = quill1.getLength();

                quill1.clipboard.dangerouslyPasteHTML(
                  pasteIndex,
                  cleanedHTML,
                  "user"
                );

                // FIXED: Calculate the correct cursor position
                const lengthAfterPaste = quill1.getLength();
                const pastedContentLength =
                  lengthAfterPaste - lengthBeforePaste;
                const newCursorPosition = pasteIndex + pastedContentLength;

                quill1.setSelection(newCursorPosition, 0);
              }
            }
            // Scroll to show the pasted content
            setTimeout(() => scrollAfterPaste(), 100);
            quill1.focus();
            processedContent = true;
            break; // done with HTML branch
          }
        }

        /* ───── Plain-text fallback ───── */
        if (!processedContent) {
          for (const item of items) {
            if (
              item.types.some(
                (t) => t.startsWith("image/") && !t.includes("docs")
              ) &&
              item.types.length === 1
            )
              continue; // skip pure images

            if (item.types.includes("text/plain")) {
              const blob = await item.getType("text/plain");
              text = await blob.text();
              break;
            }
          }
        }
      } catch (err) {
        console.error("navigator.clipboard.read failed:", err);
        try {
          text = await navigator.clipboard.readText();
        } catch (rtErr) {
          console.error("readText fallback failed:", rtErr);
        }
      }
    } else {
      try {
        text = await navigator.clipboard.readText();
      } catch (rtErr) {
        console.error("readText fallback failed:", rtErr);
      }
    }

    /* ──────────────────── (3) insert plain text ──────────────────── */
    if (text) {
      // console.log('%c[Pasted Plain Text]:', 'color: orange; font-weight: bold;', text);

      const isEmpty = quill1.getText().trim().length === 0;
      if (text.trim()) {
        if (isEmpty) {
          // Delete the auto-inserted empty paragraph if present
          if (quill1.root.innerHTML === "<p><br></p>") quill1.setText("");

          quill1.insertText(0, text, "user");
          // FIXED: Set cursor at the end of pasted text for empty editor
          quill1.setSelection(text.length, 0);
        } else {
          const selection = quill1.getSelection();
          const insertIndex = selection ? selection.index : quill1.getLength();
          const selectionLength = selection ? selection.length : 0;

          if (selectionLength > 0)
            quill1.deleteText(insertIndex, selectionLength);

          quill1.insertText(insertIndex, text, "user");

          // FIXED: Set cursor at the end of pasted content, not end of document
          const newCursorPosition = insertIndex + text.length;
          quill1.setSelection(newCursorPosition, 0);
        }
      }
      // Scroll to show the pasted content
      setTimeout(() => scrollAfterPaste(), 100);
      quill1.focus();
    }

    /* ─────────────── (4) No heading-conversion step anymore ─────────────── */
    const finalSel = quill1.getSelection();
    // console.log('%c[Final cursor position]:', 'color: red; font-weight: bold;', finalSel);
  } catch (err) {
    console.error("Clipboard handling failed:", err);
  } finally {
    // console.log('handlePaste function finished');
  }
}

/* Paste button: clears editor then pastes */
pasteButton.addEventListener("click", () => handlePaste(true, true));

/* Editor-level paste listener (blocks images, funnels to handlePaste) */
const editorElement = document.querySelector(".ql-editor");
if (editorElement) {
  editorElement.addEventListener(
    "paste",
    (e) => {
      const cb = e.clipboardData || window.clipboardData;
      let hasText = false;

      if (cb && cb.items) {
        for (const it of cb.items) {
          if (it.kind === "string" && /text\/(plain|html)/.test(it.type)) {
            hasText = true;
            break;
          }
        }

        if (!hasText) {
          for (const it of cb.items) {
            if (it.kind === "file" && it.type.startsWith("image/")) {
              console.warn("Only image files detected, blocking paste");
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }
        }
      }

      e.preventDefault();
      handlePaste(false, false);
    },
    true // capture
  );
}

/* Global safety net */
document.addEventListener(
  "paste",
  (e) => {
    const isEditorFocused =
      document.activeElement === editorElement ||
      editorElement.contains(document.activeElement);

    if (isEditorFocused) {
      // console.group('📋 Paste Event Captured');
      // // console.log('Target Element:', document.activeElement);
      // // console.log('ClipboardData:', e.clipboardData || window.clipboardData);
      // console.groupEnd();
    }
  },
  true
);
// ── Updated helper function ──────────────────────────────────────────────
function moveCaretToEnd() {
  const newLength = quill1.getLength();
  quill1.setSelection(newLength - 1, 0);
}

// Function to scroll to the end of the page after pasting text
function scrollAfterPaste() {
  // Wait longer for Quill to fully update its content
  setTimeout(() => {
    // First, scroll the Quill editor itself to the bottom
    const quillContainer = document.querySelector(".ql-container");
    const quillEditor = document.querySelector(".ql-editor");

    if (quillEditor) {
      // Scroll the Quill editor to its bottom
      quillEditor.scrollTop = quillEditor.scrollHeight;
    }

    // Then scroll the window to the bottom
    const scrollHeight = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );

    window.scrollTo({
      top: scrollHeight,
      behavior: "smooth",
    });

    // Final fallback to ensure we're at the absolute bottom
    setTimeout(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "smooth",
      });
    }, 100);
  }, 200); // Increased timeout to 200ms for Quill to update
}
// !-------------------------------- Copy paste button end ----------------------------
// ---------------------------------- Copy code
// Function to detect if the user is on a mobile device
// !-------------------------------- Copy paste button end ----------------------------
// ---------------------------------- Copy code

// Function to detect if the user is on a mobile device
function isMobileDevice() {
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  return isMobile;
}

// Function to replace colons with semicolons for mobile devices
function processTextForMobile(text) {
  const isMobile = isMobileDevice();

  if (isMobile) {
    const processed = text.replace(/:/g, ";");
    return processed;
  } else {
    return text;
  }
}

// Function to process HTML content for mobile devices
function processHtmlForMobile(html) {
  const isMobile = isMobileDevice();

  if (!isMobile) {
    return html;
  }

  // Create a temporary container to parse and modify the HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  // Process text nodes to replace colons with semicolons
  const walker = document.createTreeWalker(
    tempDiv,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  let replacementsMade = 0;
  let nodesProcessed = 0;

  while ((node = walker.nextNode())) {
    nodesProcessed++;
    const oldContent = node.textContent;

    node.textContent = node.textContent.replace(/:/g, ";");

    if (oldContent !== node.textContent) {
      replacementsMade++;
    }
  }

  const processedHtml = tempDiv.innerHTML;
  return processedHtml;
}

// UPDATED quillHtmlToPlainTextWithParagraphs function
// This handles &nbsp; paragraphs specially for proper plain text spacing
function quillHtmlToPlainTextWithParagraphs(html) {
  // Log HTML structure analysis
  const tagMatches = html.match(/<([a-z0-9]+)[\s>]/gi);

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  // *** NEW *** PRE-PROCESS &nbsp;-only paragraphs before text conversion
  const nbspParagraphs = tempDiv.querySelectorAll("p");
  let nbspParagraphsProcessed = 0;

  nbspParagraphs.forEach((p, index) => {
    const innerHTML = p.innerHTML.trim();
    const textContent = p.textContent.trim();

    // Check if this paragraph contains ONLY &nbsp; (which becomes a space in textContent)
    const isNbspOnly =
      innerHTML === "&nbsp;" ||
      innerHTML === "&nbsp" ||
      (textContent === " " && innerHTML.includes("&nbsp;"));

    if (isNbspOnly) {
      // Replace with a special marker that we'll handle differently
      p.setAttribute("data-empty-line", "true");
      p.innerHTML = ""; // Make it truly empty for text processing
      nbspParagraphsProcessed++;
    }
  });

  // Count and log BR elements
  const brElements = tempDiv.querySelectorAll("br");

  // Clean up specific <p><br></p> after <strong>
  (function cleanInitialEmptyParagraphAfterStrong() {
    const children = Array.from(tempDiv.childNodes);

    if (children.length >= 2) {
      if (
        children[0].nodeType === Node.ELEMENT_NODE &&
        children[0].tagName === "STRONG" &&
        children[1].tagName === "P"
      ) {
        const firstParagraph = children[1];

        if (firstParagraph.childNodes.length === 1) {
          if (firstParagraph.firstChild.tagName === "BR") {
            tempDiv.removeChild(firstParagraph);
          }
        }
      }
    }
  })();

  // Create a string to hold our processed content
  let plainTextContent = "";

  // Track list state
  let inList = false;
  let listLevel = 0;
  let bulletFormats = [" • ", " - ", " * "]; // Different bullet styles for nesting

  // *** UPDATED *** Map of elements with SPECIAL handling for empty-line paragraphs
  const blockElements = {
    H1: {
      before: "\n\n",
      after: "\n\n",
      process: (text) => text.toUpperCase(),
    },
    H2: { before: "\n\n", after: "\n\n", process: (text) => text },
    H3: { before: "\n\n", after: "\n\n", process: (text) => text },
    H4: { before: "\n\n", after: "\n\n", process: (text) => text },
    H5: { before: "\n\n", after: "\n\n", process: (text) => text },
    H6: { before: "\n\n", after: "\n\n", process: (text) => text },
    P: {
      before: (node) => {
        // *** SPECIAL HANDLING *** for empty-line paragraphs
        if (node.hasAttribute("data-empty-line")) {
          return "\n"; // Just one newline for spacing
        }
        return "\n"; // Normal paragraph start
      },
      after: (node) => {
        // *** SPECIAL HANDLING *** for empty-line paragraphs
        if (node.hasAttribute("data-empty-line")) {
          return "\n"; // Just one newline after
        }
        return "\n\n"; // Normal paragraph end with double newline
      },
      process: (text) => text,
    },
    DIV: { before: "", after: "\n", process: (text) => text },
    BLOCKQUOTE: { before: "\n\n> ", after: "\n\n", process: (text) => text },
    UL: {
      before: "\n",
      after: "\n",
      process: (text) => text,
      onEnter: () => {
        inList = true;
        listLevel++;
      },
      onExit: () => {
        inList = listLevel > 1;
        listLevel--;
      },
    },
    OL: {
      before: "\n",
      after: "\n",
      process: (text) => text,
      onEnter: () => {
        inList = true;
        listLevel++;
      },
      onExit: () => {
        inList = listLevel > 1;
        listLevel--;
      },
    },
    LI: {
      before: (node) => {
        // Calculate indentation safely (never negative)
        if (node.parentNode.tagName === "OL") {
          // For ordered lists: indent = listLevel * 2 (clamped ≥ 0)
          const indent = Math.max(0, listLevel * 2);
          const listItems = Array.from(node.parentNode.children);
          const index = listItems.indexOf(node) + 1;
          const result = `\n${" ".repeat(indent)}${index}. `;
          return result;
        } else {
          // For unordered lists: indent = (listLevel - 1)*2, but ≥ 0
          const rawIndent = (listLevel - 1) * 2;
          const indent = Math.max(0, rawIndent);
          // Bullet index also clamped ≥ 0
          const bulletIndex = Math.max(
            0,
            Math.min(listLevel - 1, bulletFormats.length - 1)
          );
          const bulletStyle = bulletFormats[bulletIndex];
          const result = `\n${" ".repeat(indent)}${bulletStyle}`;
          return result;
        }
      },
      after: "",
      process: (text) => text,
    },
    TR: { before: "", after: "\n", process: (text) => text },
    TD: { before: "", after: "\t", process: (text) => text },
    TH: { before: "", after: "\t", process: (text) => text.toUpperCase() },
    TABLE: { before: "\n\n", after: "\n\n", process: (text) => text },
    STRONG: { before: "", after: "", process: (text) => text },
    B: { before: "", after: "", process: (text) => text },
    EM: { before: "", after: "", process: (text) => text },
    I: { before: "", after: "", process: (text) => text },
    CODE: { before: " `", after: "` ", process: (text) => text },
    PRE: { before: "\n```\n", after: "\n```\n", process: (text) => text },
    SPAN: { before: "", after: "", process: (text) => text },
    MARK: { before: "", after: "", process: (text) => text },
    A: { before: "", after: "", process: (text) => text },
  };

  // Recursive function to process nodes
  function processNode(node, depth = 0) {
    if (!node) {
      return;
    }

    // Skip script and style tags
    if (node.tagName === "SCRIPT" || node.tagName === "STYLE") {
      return;
    }

    // Handle element nodes
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toUpperCase();
      const elementConfig = blockElements[tagName];

      // Handle block elements with special formatting
      if (elementConfig) {
        // Add the "before" formatting
        if (typeof elementConfig.before === "function") {
          const beforeResult = elementConfig.before(node);
          plainTextContent += beforeResult;
        } else {
          plainTextContent += elementConfig.before;
        }

        // Call onEnter if exists
        if (elementConfig.onEnter) {
          elementConfig.onEnter();
        }

        // Special handling for headings
        if (/^H[1-6]$/.test(tagName)) {
          const headingText = node.textContent.trim();
          const processedText = elementConfig.process(headingText);
          plainTextContent += processedText;
        } else if (tagName === "P" && node.hasAttribute("data-empty-line")) {
          // *** SPECIAL HANDLING *** for empty-line paragraphs - don't process children
        } else {
          // Process children recursively
          for (let i = 0; i < node.childNodes.length; i++) {
            processNode(node.childNodes[i], depth + 1);
          }
        }

        // Call onExit if exists
        if (elementConfig.onExit) {
          elementConfig.onExit();
        }

        // Add the "after" formatting
        if (typeof elementConfig.after === "function") {
          const afterResult = elementConfig.after(node);
          plainTextContent += afterResult;
        } else {
          plainTextContent += elementConfig.after;
        }
      } else {
        // For other elements, just process their children
        for (let i = 0; i < node.childNodes.length; i++) {
          processNode(node.childNodes[i], depth + 1);
        }
      }
    }
    // Handle text nodes
    else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent; // ✅ DON'T trim() - preserves intentional spaces

      if (text) {
        // Add the text content
        plainTextContent += text;

        // Check parent and next sibling for inline context
        const parentTagName = node.parentNode.tagName
          ? node.parentNode.tagName.toUpperCase()
          : "";
        const isInlineParent = [
          "SPAN",
          "STRONG",
          "EM",
          "B",
          "I",
          "MARK",
          "A",
        ].includes(parentTagName);

        // Check if next sibling is an inline element
        const nextSibling = node.nextSibling;
        const nextIsInline =
          nextSibling &&
          nextSibling.nodeType === Node.ELEMENT_NODE &&
          ["SPAN", "STRONG", "EM", "B", "I", "MARK", "A"].includes(
            nextSibling.tagName.toUpperCase()
          );

        // ✅ ENHANCED CONDITION: Only add space if not in inline context
        const shouldAddSpace =
          !inList &&
          !isInlineParent &&
          !nextIsInline &&
          !["LI", "H1", "H2", "H3", "H4", "H5", "H6", "CODE", "PRE"].includes(
            parentTagName
          ) &&
          !text.endsWith(" ") && // Don't double-add spaces
          !text.endsWith("\n");

        if (shouldAddSpace) {
          plainTextContent += " ";
        }
      }
    }
  }

  // Start processing from the root
  processNode(tempDiv);

  // Replace the BR placeholders with actual newlines
  const brPlaceholderCount = (
    plainTextContent.match(/__BR_PLACEHOLDER__/g) || []
  ).length;
  plainTextContent = plainTextContent.replace(/__BR_PLACEHOLDER__/g, "\n");

  // Post-processing cleanup
  const beforeCleanup = plainTextContent.length;

  plainTextContent = plainTextContent
    // Cleanup multiple consecutive newlines (more than 2)
    .replace(/\n{3,}/g, "\n\n")
    // Remove excessive spaces
    .replace(/ {2,}/g, " ")
    // Fix spacing around list indicators
    .replace(/\n([ ]*)(•|-|\*|\d+\.) {2,}/g, "\n$1$2 ")
    // Trim leading/trailing whitespace
    .trim();

  const afterCleanup = plainTextContent.length;

  return plainTextContent;
}

function processHtmlForCopy(htmlContent, context = "unknown") {
  // Step 1: Apply removeHamDanTags first
  try {
    htmlContent = removeHamDanTags(htmlContent);
  } catch (error) {}

  // Step 2: Apply removeMarkTags
  try {
    htmlContent = removeMarkTags(htmlContent);
  } catch (error) {}
  try {
    htmlContent = normalizeEmojisInHtml(htmlContent);
  } catch (error) {}

  // Step 3: Apply bullet list conversion
  try {
    htmlContent = convertBulletListToUlForCopy(htmlContent);
  } catch (error) {}

  // Step 4: *** CRITICAL *** UNIVERSAL HTML SPACING FIX
  try {
    htmlContent = makeUniversalSpacingCompatible(htmlContent);
  } catch (error) {}

  return htmlContent;
}

function processQuillContentForCopy(quillInstance) {
  // Get the editor container element
  const editorContainer = quillInstance.container.querySelector(".ql-editor");

  if (!editorContainer) {
    return { html: "", text: "" };
  }

  // Log Quill's formats and content details
  try {
    const formats = quillInstance.getFormat();
    const contentLength = quillInstance.getLength();
    const selection = quillInstance.getSelection();
  } catch (error) {}

  // Check for headings in the Quill content
  const deltaContents = quillInstance.getContents();

  // Look for header formats in the delta
  let hasHeaders = false;
  let headerContents = [];
  if (deltaContents && deltaContents.ops) {
    deltaContents.ops.forEach((op, index) => {
      // Check for headers in the attributes
      if (op.attributes && op.attributes.header) {
        hasHeaders = true;

        // Try to find the content for this header
        if (
          index > 0 &&
          deltaContents.ops[index - 1].insert &&
          typeof deltaContents.ops[index - 1].insert === "string"
        ) {
          const headerContent = {
            level: op.attributes.header,
            text: deltaContents.ops[index - 1].insert.trim(),
          };
          headerContents.push(headerContent);
        }
      }
    });
  }

  // Get the initial HTML content
  let htmlContent = editorContainer.innerHTML;

  try {
    htmlContent = removeMarkTags(htmlContent);
  } catch (error) {}

  // *** USE THE NEW CENTRAL PROCESSING FUNCTION ***
  htmlContent = processHtmlForCopy(htmlContent, "full-content");

  // Now create tempDiv with the processed HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlContent;

  // Remove paragraph tags with only BR tags that follow heading tags
  const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"];
  let totalParagraphsRemoved = 0;

  headingTags.forEach((hTag) => {
    const headings = tempDiv.querySelectorAll(hTag);

    headings.forEach((heading, index) => {
      // Check if the next sibling is a paragraph
      const nextSibling = heading.nextElementSibling;

      if (nextSibling && nextSibling.tagName === "P") {
        // Check if paragraph only contains a BR tag
        const onlyBrChild =
          nextSibling.childNodes.length === 1 &&
          nextSibling.firstChild &&
          nextSibling.firstChild.nodeType === Node.ELEMENT_NODE &&
          nextSibling.firstChild.tagName === "BR";

        const onlyBrInnerHTML =
          nextSibling.innerHTML.trim() === "<br>" ||
          nextSibling.innerHTML.trim() === "<br/>" ||
          nextSibling.innerHTML.trim() === "<br />";

        if (onlyBrChild || onlyBrInnerHTML) {
          // Remove the paragraph with BR
          nextSibling.parentNode.removeChild(nextSibling);
          totalParagraphsRemoved++;
        }
      }
    });
  });

  // Remove Quill UI elements that shouldn't be copied
  const quillUiElements = tempDiv.querySelectorAll(".ql-ui");

  quillUiElements.forEach((el, index) => {
    el.parentNode.removeChild(el);
  });

  // Count headings before conversion for debug
  const headingCounts = {};
  headingTags.forEach((hTag) => {
    const count = tempDiv.querySelectorAll(hTag).length;
    if (count > 0) {
      headingCounts[hTag] = count;
    }
  });

  // Store heading texts before transformation so we can ensure they appear in plain text
  const headingTexts = [];
  headingTags.forEach((hTag) => {
    const headings = tempDiv.querySelectorAll(hTag);

    headings.forEach((heading, index) => {
      const text = heading.textContent.trim();
      headingTexts.push(text);
    });
  });

  // Convert all h tags (h1-h6) to strong tags
  let totalHeadingsConverted = 0;

  headingTags.forEach((hTag) => {
    const headings = tempDiv.querySelectorAll(hTag);

    headings.forEach((heading, idx) => {
      const strongElement = document.createElement("strong");
      strongElement.innerHTML = heading.innerHTML;
      heading.parentNode.replaceChild(strongElement, heading);
      totalHeadingsConverted++;
    });
  });

  // Check if headings were properly replaced
  const remainingHeadings = tempDiv.querySelectorAll("h1, h2, h3, h4, h5, h6");
  if (remainingHeadings.length > 0) {
    remainingHeadings.forEach((heading, index) => {});
  }

  // Remove background color, font size, and font family from all elements
  const allElements = tempDiv.querySelectorAll("*");

  let styleModifications = 0;
  allElements.forEach((el, index) => {
    const beforeStyle = el.getAttribute("style");

    el.style.backgroundColor = "";
    el.style.fontSize = "";
    el.style.fontFamily = "";

    // Also remove these properties from the style attribute
    if (el.hasAttribute("style")) {
      let style = el.getAttribute("style");
      const originalStyle = style;

      style = style.replace(/background(-color)?:[^;]+;?/gi, "");
      style = style.replace(/font-size:[^;]+;?/gi, "");
      style = style.replace(/font-family:[^;]+;?/gi, "");
      style = style.replace(/color:[^;]+;?/gi, ""); // Remove font color

      if (style.trim() === "") {
        el.removeAttribute("style");
      } else {
        el.setAttribute("style", style);
      }

      const afterStyle = el.getAttribute("style") || "";
      if (beforeStyle !== afterStyle) {
        styleModifications++;
      }
    }
  });

  // Clean root level styles
  if (tempDiv.style) {
    const rootStylesBefore = {
      backgroundColor: tempDiv.style.backgroundColor,
      fontSize: tempDiv.style.fontSize,
      fontFamily: tempDiv.style.fontFamily,
      color: tempDiv.style.color,
    };

    tempDiv.style.backgroundColor = "";
    tempDiv.style.fontSize = "";
    tempDiv.style.fontFamily = "";
    tempDiv.style.color = "";
  }

  // Get the final processed HTML
  htmlContent = tempDiv.innerHTML;

  // Log list structure for debugging
  const finalOlCount = tempDiv.querySelectorAll("ol").length;
  const finalUlCount = tempDiv.querySelectorAll("ul").length;

  // Log other structural elements
  const finalCounts = {
    p: tempDiv.querySelectorAll("p").length,
    strong: tempDiv.querySelectorAll("strong").length,
    em: tempDiv.querySelectorAll("em").length,
    span: tempDiv.querySelectorAll("span").length,
    div: tempDiv.querySelectorAll("div").length,
  };

  // let textContent = quillHtmlToPlainTextWithParagraphs(htmlContent);
  let textContent = quillHtmlToPlainTextWithParagraphs(htmlContent);

  // Check if we need to manually add heading text that might have been lost
  if (hasHeaders && headingTexts.length > 0) {
    let missingHeadings = [];

    for (const headingText of headingTexts) {
      const isPresent = textContent.includes(headingText);

      if (!isPresent) {
        missingHeadings.push(headingText);
      }
    }

    // If any headings are missing, add them at the beginning
    if (missingHeadings.length > 0) {
      let newTextContent = "";

      for (const headingText of missingHeadings) {
        newTextContent += headingText + "\n\n";
      }

      newTextContent += textContent;
      textContent = newTextContent;
    }
  }

  // For mobile devices, replace colons with semicolons
  if (isMobileDevice()) {
    const htmlBefore = htmlContent.length;
    const textBefore = textContent.length;

    htmlContent = processHtmlForMobile(htmlContent);
    textContent = processTextForMobile(textContent);
  }

  return {
    html: htmlContent,
    text: textContent,
  };
}

// Your existing convertBulletListToUlForCopy function
function convertBulletListToUlForCopy(htmlString) {
  const parser = new DOMParser();

  const doc = parser.parseFromString(htmlString, "text/html");

  const olElements = [...doc.querySelectorAll("ol")];

  let totalUlsCreated = 0;
  let totalLisMoved = 0;
  let totalOlsReplaced = 0;

  olElements.forEach((ol, olIndex) => {
    const ul = document.createElement("ul");
    let liMoved = false;
    let bulletLisFound = 0;
    let totalLisInOl = ol.children.length;

    [...ol.children].forEach((li, liIndex) => {
      const dataList = li.getAttribute("data-list");

      if (dataList === "bullet") {
        li.removeAttribute("data-list");
        ul.appendChild(li.cloneNode(true));
        li.remove();
        liMoved = true;
        bulletLisFound++;
        totalLisMoved++;
      }
    });

    if (liMoved) {
      totalUlsCreated++;

      // If all lis were bullets, just replace the entire ol
      if (ol.children.length === 0) {
        ol.replaceWith(ul);
        totalOlsReplaced++;
      } else {
        // Otherwise, insert ul before ol and keep ol for numbered items
        ol.parentNode.insertBefore(ul, ol);
      }
    }
  });

  const resultHtml = doc.body.innerHTML;

  // Final verification
  const finalOlCount = doc.querySelectorAll("ol").length;
  const finalUlCount = doc.querySelectorAll("ul").length;

  return resultHtml;
}

function setupQuillCopyHandler(quillInstance) {
  // Get the editor element
  const editorElement = quillInstance.container;

  if (!editorElement) {
    return;
  }

  // Listen for copy events on the editor
  editorElement.addEventListener("copy", (e) => {
    // Get the actual DOM selection (not Quill's selection)
    const domSelection = window.getSelection();

    if (domSelection.rangeCount === 0 || domSelection.isCollapsed) {
      return;
    }

    // Check if the selection is within our Quill editor
    const quillEditor = quillInstance.container.querySelector(".ql-editor");

    const range = domSelection.getRangeAt(0);

    // Check if the selection is within the Quill editor
    const isWithinEditor =
      quillEditor.contains(range.commonAncestorContainer) ||
      range.commonAncestorContainer === quillEditor;

    if (!isWithinEditor) {
      return;
    }

    try {
      // *** EXTRACT THE ACTUAL SELECTED HTML STRUCTURE ***

      // Clone the selected content as a document fragment
      const selectedFragment = range.cloneContents();

      // Create a temporary div to hold the fragment and get its HTML
      const tempDiv = document.createElement("div");
      tempDiv.appendChild(selectedFragment);

      let selectedHtml = tempDiv.innerHTML;

      try {
        selectedHtml = removeMarkTags(selectedHtml);
      } catch (error) {}

      // If we got empty or minimal content, try a different approach
      if (!selectedHtml.trim()) {
        // Alternative: Create a new range and try again
        const newRange = document.createRange();
        newRange.selectNodeContents(range.commonAncestorContainer);
        const altFragment = newRange.cloneContents();
        const altDiv = document.createElement("div");
        altDiv.appendChild(altFragment);
        selectedHtml = altDiv.innerHTML;
      }

      // Get the plain text version for comparison
      const selectedText = domSelection.toString();

      if (!selectedText || selectedText.trim() === "") {
        return;
      }

      // *** APPLY UPDATED UNIVERSAL HTML PROCESSING ***
      selectedHtml = processHtmlForCopy(selectedHtml, "selection");

      // Process the selected HTML content
      const processDiv = document.createElement("div");
      processDiv.innerHTML = selectedHtml;

      // Check for formatting types in the selected content
      const hasHeadings = /h[1-6]/i.test(selectedHtml);
      const hasBulletList =
        /data-list="bullet"/i.test(selectedHtml) ||
        processDiv.querySelector("ul");
      const hasNumberedList =
        /data-list="ordered"/i.test(selectedHtml) ||
        processDiv.querySelector("ol");
      const hasTables = processDiv.querySelector("table") !== null;

      const formattingAnalysis = {
        headings: hasHeadings,
        bullets: hasBulletList,
        numbered: hasNumberedList,
        tables: hasTables,
      };

      // Apply transformations while preserving structure

      // 1. Convert headings to strong tags (preserve your existing logic)
      const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"];
      let totalHeadingsConverted = 0;

      headingTags.forEach((hTag) => {
        const headings = processDiv.querySelectorAll(hTag);

        headings.forEach((heading, index) => {
          const strongElement = document.createElement("strong");
          strongElement.innerHTML = heading.innerHTML;
          heading.parentNode.replaceChild(strongElement, heading);
          totalHeadingsConverted++;
        });
      });

      // 2. Remove empty paragraphs after strong tags (preserve your existing logic)
      const strongElements = processDiv.querySelectorAll("strong");
      let emptyParagraphsRemoved = 0;

      strongElements.forEach((strong, index) => {
        const nextSibling = strong.nextElementSibling;

        if (nextSibling && nextSibling.tagName === "P") {
          const isEmpty =
            (nextSibling.childNodes.length === 1 &&
              nextSibling.firstChild &&
              nextSibling.firstChild.nodeType === Node.ELEMENT_NODE &&
              nextSibling.firstChild.tagName === "BR") ||
            nextSibling.innerHTML.trim() === "<br>" ||
            nextSibling.innerHTML.trim() === "<br/>" ||
            nextSibling.innerHTML.trim() === "<br />";

          if (isEmpty) {
            nextSibling.parentNode.removeChild(nextSibling);
            emptyParagraphsRemoved++;
          }
        }
      });

      // 3. Clean up styles (preserve your existing logic)
      const allElements = processDiv.querySelectorAll("*");

      let styleModifications = 0;
      allElements.forEach((el, index) => {
        const beforeStyle = el.getAttribute("style");

        // Remove unwanted styles but preserve table structure
        el.style.backgroundColor = "";
        el.style.fontSize = "";
        el.style.fontFamily = "";
        el.style.color = "";

        if (el.hasAttribute("style")) {
          let style = el.getAttribute("style");
          const originalStyle = style;

          style = style.replace(/background(-color)?:[^;]+;?/gi, "");
          style = style.replace(/font-size:[^;]+;?/gi, "");
          style = style.replace(/font-family:[^;]+;?/gi, "");
          style = style.replace(/color:[^;]+;?/gi, "");

          if (style.trim() === "") {
            el.removeAttribute("style");
          } else {
            el.setAttribute("style", style);
          }

          if (originalStyle !== (el.getAttribute("style") || "")) {
            styleModifications++;
          }
        }
      });

      // Get the processed HTML
      let htmlContent = processDiv.innerHTML;

      // *** UPDATED *** Generate text with universal spacing
      let textContent = quillHtmlToPlainTextWithParagraphs(htmlContent);

      // *** NEW *** Apply universal text spacing to selection

      // Generate better formatted plain text if we have formatting
      if (hasHeadings || hasBulletList || hasNumberedList || hasTables) {
        textContent = quillHtmlToPlainTextWithParagraphs(htmlContent);
      }

      // Apply mobile processing if needed (preserve your existing logic)
      if (isMobileDevice()) {
        const htmlBefore = htmlContent.length;
        const textBefore = textContent.length;

        htmlContent = processHtmlForMobile(htmlContent);
        textContent = processTextForMobile(textContent);
      }

      // Set the clipboard data
      e.clipboardData.setData("text/html", htmlContent);
      e.clipboardData.setData("text/plain", textContent);

      // Prevent default copy behavior
      e.preventDefault();
    } catch (error) {
      // Let default behavior happen on error
      return;
    }
  });
}

// Handle copy button click for Quill
const handleQuillCopy = async () => {
  try {
    // Get the content from Quill
    const { html: htmlContent, text: textContent } =
      processQuillContentForCopy(quill1);

    // For modern browsers, use the clipboard API
    if (navigator.clipboard && navigator.clipboard.write) {
      try {
        const clipboardItems = [
          new ClipboardItem({
            "text/html": new Blob([htmlContent], { type: "text/html" }),
            "text/plain": new Blob([textContent], { type: "text/plain" }),
          }),
        ];

        await navigator.clipboard.write(clipboardItems);
      } catch (clipboardError) {
        throw clipboardError; // Re-throw to fall back to alternative method
      }
    } else {
      throw new Error("Modern clipboard API not supported");
    }

    // Update the copy button
    updateCopyButton(true);
    setTimeout(() => {
      updateCopyButton(false);
    }, 2000);
  } catch (err) {
    try {
      // Fallback method for browsers without clipboard API support
      const tempElement = document.createElement("div");
      tempElement.setAttribute("contenteditable", "true");
      tempElement.innerHTML = htmlContent;
      tempElement.style.position = "absolute";
      tempElement.style.left = "-9999px";
      tempElement.style.top = "-9999px";
      document.body.appendChild(tempElement);

      // Select the content
      const range = document.createRange();
      range.selectNodeContents(tempElement);

      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      // Execute copy command
      const copySuccess = document.execCommand("copy");

      // Clean up
      selection.removeAllRanges();
      document.body.removeChild(tempElement);

      if (copySuccess) {
        updateCopyButton(true);
        setTimeout(() => updateCopyButton(false), 2000);
      } else {
        throw new Error("execCommand copy failed");
      }
    } catch (fallbackErr) {
      try {
        await navigator.clipboard.writeText(quill1.getText());
        updateCopyButton(true);
        setTimeout(() => updateCopyButton(false), 2000);
      } catch (textOnlyError) {}
    }
  }
};

const updateCopyButton = (copied) => {
  const copyButton = document.getElementById("copyBtn");

  if (!copyButton) {
    return;
  }

  const beforeHTML = copyButton.innerHTML;

  if (copied) {
    copyButton.innerHTML = `<svg width="19" height="16" viewBox="0 0 19 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.717 2.4933C18.0728 3.41378 17.5739 4.044 16.6082 4.66478C15.8291 5.16566 14.8364 5.70829 13.7846 6.63598C12.7535 7.54541 11.7472 8.64078 10.8529 9.71889C9.96223 10.7926 9.20522 11.8218 8.67035 12.5839C8.32471 13.0764 7.84234 13.8109 7.84234 13.8109C7.50218 14.3491 6.89063 14.6749 6.23489 14.6667C5.57901 14.6585 4.97657 14.3178 4.65113 13.7711C3.81924 12.3735 3.1773 11.8216 2.88226 11.6234C2.09282 11.0928 1.1665 11.0144 1.1665 9.77812C1.1665 8.79631 1.99558 8.0004 3.0183 8.0004C3.74035 8.02706 4.41149 8.31103 5.00613 8.71063C5.38625 8.96607 5.78891 9.30391 6.20774 9.74862C6.69929 9.07815 7.29164 8.30461 7.95566 7.5041C8.91998 6.34155 10.0582 5.09441 11.2789 4.0178C12.4788 2.95945 13.8662 1.96879 15.3367 1.445C16.2956 1.10347 17.3613 1.57281 17.717 2.4933Z" stroke="#414141" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg> Kopieret!`;
  } else {
    copyButton.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g clip-path="url(#clip0_373_2280)">
                <path d="M7.5 12.5C7.5 10.143 7.5 8.96447 8.23223 8.23223C8.96447 7.5 10.143 7.5 12.5 7.5L13.3333 7.5C15.6904 7.5 16.8689 7.5 17.6011 8.23223C18.3333 8.96447 18.3333 10.143 18.3333 12.5V13.3333C18.3333 15.6904 18.3333 16.8689 17.6011 17.6011C16.8689 18.3333 15.6904 18.3333 13.3333 18.3333H12.5C10.143 18.3333 8.96447 18.3333 8.23223 17.6011C7.5 16.8689 7.5 15.6904 7.5 13.3333L7.5 12.5Z" stroke="#414141" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14.1665 7.49984C14.1646 5.03559 14.1273 3.75918 13.41 2.88519C13.2715 2.71641 13.1167 2.56165 12.9479 2.42314C12.026 1.6665 10.6562 1.6665 7.91663 1.6665C5.17706 1.6665 3.80727 1.6665 2.88532 2.42314C2.71654 2.56165 2.56177 2.71641 2.42326 2.88519C1.66663 3.80715 1.66663 5.17694 1.66663 7.9165C1.66663 10.6561 1.66663 12.0259 2.42326 12.9478C2.56177 13.1166 2.71653 13.2714 2.88531 13.4099C3.7593 14.1271 5.03572 14.1645 7.49996 14.1664" stroke="#414141" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </g>
            <defs>
                <clipPath id="clip0_373_2280">
                    <rect width="20" height="20" fill="white"/>
                </clipPath>
            </defs>
        </svg>
        <span>Kopier</span>`;
  }

  const afterHTML = copyButton.innerHTML;
};

// Initialize the copy functionality
function initQuillCopy() {
  // Check if quill1 is available
  if (typeof quill1 === "undefined") {
  } else {
  }

  // Set up copy handler for Quill
  try {
    setupQuillCopyHandler(quill1);
  } catch (error) {}

  // Add event listener to the copy button
  const copyButton = document.getElementById("copyBtn");

  if (copyButton) {
    copyButton.addEventListener("click", handleQuillCopy);
  } else {
    const elementsWithIds = document.querySelectorAll("[id]");
    elementsWithIds.forEach((el, index) => {});
  }
}

// Execute the initialization when the page loads
document.addEventListener("DOMContentLoaded", () => {
  initQuillCopy();
});

// Universal fix that works across ALL platforms without breaking existing functionality
function makeUniversalSpacingCompatible(htmlContent) {
  // Create a temporary div to work with the HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlContent;

  // Find all paragraphs that ONLY contain BR tags (empty line spacing)
  const paragraphs = tempDiv.querySelectorAll("p");
  let emptyParagraphsFound = 0;
  let emptyParagraphsModified = 0;

  paragraphs.forEach((p, index) => {
    // VERY SPECIFIC CHECK: Only target paragraphs that are truly empty spacing
    const isEmptySpacing =
      // Exact BR variations
      p.innerHTML.trim() === "<br>" ||
      p.innerHTML.trim() === "<br/>" ||
      p.innerHTML.trim() === "<br />" ||
      // Single BR child node
      (p.childNodes.length === 1 &&
        p.firstChild.nodeType === Node.ELEMENT_NODE &&
        p.firstChild.tagName === "BR" &&
        p.textContent.trim() === "");

    if (isEmptySpacing) {
      emptyParagraphsFound++;

      // UNIVERSAL SOLUTION: Use non-breaking space
      p.innerHTML = "&nbsp;";

      emptyParagraphsModified++;
    } else if (p.textContent.trim() === "" && p.innerHTML.trim() === "") {
      // Handle completely empty paragraphs (edge case)
      p.innerHTML = "&nbsp;";
      emptyParagraphsModified++;
    }
  });

  const result = tempDiv.innerHTML;

  return result;
}
// Add this function to normalize emojis before copying
function normalizeEmojisInHtml(htmlContent) {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlContent;

  // Find all emoji img elements and replace with Unicode
  const emojiImages = tempDiv.querySelectorAll('img.emoji, img[role="img"]');

  emojiImages.forEach((img) => {
    const altText = img.getAttribute("alt");

    // If alt text contains an emoji, replace the img with the emoji
    if (
      altText &&
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(
        altText
      )
    ) {
      const textNode = document.createTextNode(altText);
      img.parentNode.replaceChild(textNode, img);
    }
  });

  return tempDiv.innerHTML;
}
// ---------------------------------- File uploading code --------------------------------------

// ! final version

// Set file limits
const MAX_IMAGES = 5;
const MAX_DOCUMENTS = 1;

// Updated file processing function to handle images, PDFs, and DOCX files
document.getElementById("uploadImg").addEventListener("click", function () {
  document.getElementById("imageUpload").click();
  manuallyCloseMicButton("micButton1");
});

// Add file input constraints to HTML element
const imageUploadInput = document.getElementById("imageUpload");
imageUploadInput.setAttribute("multiple", "true");
imageUploadInput.setAttribute(
  "accept",
  "image/*,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
);

const uploadImg = document.getElementById("uploadImg");
document
  .getElementById("imageUpload")
  .addEventListener("change", async function (event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    try {
      handleClear();
      showLoader(".textarea-wrapper", "Uploader tekst...");
      uploadImg.disabled = true;

      // Separate files by type
      const imageFiles = files.filter((file) =>
        file.type.toLowerCase().includes("image/")
      );
      const pdfFiles = files.filter(
        (file) => file.type.toLowerCase() === "application/pdf"
      );
      const docxFiles = files.filter(
        (file) =>
          file.type.toLowerCase() ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );

      // Validate file counts
      if (imageFiles.length > MAX_IMAGES) {
        throw new Error(
          `Du kan maksimalt uploade ${MAX_IMAGES} billeder ad gangen.`
        );
      }

      if (pdfFiles.length > MAX_DOCUMENTS || docxFiles.length > MAX_DOCUMENTS) {
        throw new Error("Du kan kun uploade ét dokument ad gangen.");
      }

      let extractedText = "";
      let ocrUsed = false; // Track if OCR was used

      // Process images (OCR always used)
      if (imageFiles.length > 0) {
        ocrUsed = true; // Images always use OCR
        let combinedImageText = "";
        for (let i = 0; i < imageFiles.length; i++) {
          // Check if image has EXIF data (likely from mobile camera)
          const hasExifData = await checkForExifData(imageFiles[i]);

          let imageText = "";
          if (
            hasExifData ||
            imageFiles[i].type.toLowerCase().includes("heic") ||
            imageFiles[i].type.toLowerCase().includes("heif")
          ) {
            // Process with mobile-optimized OCR if EXIF data exists
            const imageTextResult = await processImageWithOCR(imageFiles[i]);
            imageText = imageTextResult.text;
          } else {
            // Process with original OCR if no EXIF data
            imageText = await processImageWithOCRForPDF(imageFiles[i]);
          }

          combinedImageText += imageText + "\n\n";
        }
        extractedText += combinedImageText;
      }

      // Process PDF - check if OCR was used
      if (pdfFiles.length > 0) {
        const pdfResult = await processEnhancedPDF(pdfFiles[0]);
        extractedText += pdfResult.text;

        // Check if OCR was used in PDF processing
        if (pdfResult.usedOCR) {
          ocrUsed = true;
        }

        //// console.log("PDF processing result:", pdfResult);
        //// console.log("OCR used in PDF:", pdfResult.usedOCR);
      }

      // Process DOCX (OCR never used)
      if (docxFiles.length > 0) {
        const docxText = await processDOCXFile(docxFiles[0]);
        //// console.log("DOCX text extracted:", docxText);
        extractedText += docxText;
        // OCR is never used for DOCX, so ocrUsed remains as is
      }

      // Process the extracted text based on whether OCR was used
      if (extractedText) {
        if (ocrUsed) {
          // OCR was used, call OCRImproveCall
          //// console.log("OCR was used, calling OCRImproveCall");
          OCRImproveCall(extractedText);
        } else {
          // No OCR was used, directly display text and disable loader
          //// console.log("No OCR was used, displaying text directly");

          if (pdfFiles.length > 0) {
            const formattedText = formatExtractedText(extractedText);
            displayPDF(formattedText);
            setTimeout(() => scrollAfterPaste(), 100);
          } else if (docxFiles.length > 0) {
            displayResponse(extractedText);
            setTimeout(() => scrollAfterPaste(), 100);
          }

          // Disable loader since no OCR processing is needed
          hideLoader(".textarea-wrapper");
          uploadImg.disabled = false;
        }
      } else {
        throw new Error("Ingen tekst kunne udtrækkes fra filen.");
      }

      // Reset the file input
      event.target.value = "";
    } catch (error) {
      console.error("Processing Error:", error);
      alert("Der opstod en fejl under behandling af filen: " + error.message);
      uploadImg.disabled = false;
      hideLoader(".textarea-wrapper");
      // Reset the file input
      event.target.value = "";
    }
  });
// Function to compress an image using the server endpoint
async function compressImageOnServer(file) {
  try {
    // Create a FormData object to send the file
    // //// console.log("inside compressImageOnServer")
    const formData = new FormData();
    formData.append("image", file);

    // Show compression progress
    // uploadingProgressBar.style.width = '30%';

    // Send the image to the compression server
    const response = await fetch("https://tale-skrivsikkert.dk/converter/api", {
      method: "POST",
      body: formData,
      credentials: "include", // Include cookies if needed for authentication
    });
    // //// console.log("called file got !")
    if (!response.ok) {
      throw new Error(
        `Server returned ${response.status}: ${response.statusText}`
      );
    }

    // Get the compressed image as a blob
    const compressedImageBlob = await response.blob();

    // Create a new file from the blob with an appropriate name
    const compressedFile = new File(
      [compressedImageBlob],
      file.name.replace(/\.[^.]+$/, ".jpg"), // Replace extension with .jpg
      { type: "image/jpeg" }
    );
    // //// console.log("this is compressed file ")
    // uploadingProgressBar.style.width = '50%';
    return compressedFile;
  } catch (error) {
    console.error("Image compression error:", error);
    // If compression fails, return the original file
    return file;
  }
}

function isMobileDeviceForImageForImage() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

// Enhanced OCR function for mobile camera images
async function processImageWithOCR(file) {
  try {
    // Check if the file is an image and we should use server compression
    if (file.type.toLowerCase().includes("image")) {
      // For iPhone HEIC/HEIF images or any images on mobile, use server compression
      if (
        isMobileDeviceForImage() ||
        file.type.toLowerCase().includes("heic") ||
        file.type.toLowerCase().includes("heif")
      ) {
        try {
          // //// console.log("mobile check is passed")
          // Compress the image on the server first
          file = await compressImageOnServer(file);
        } catch (compressionError) {
          console.error(
            "Compression error, continuing with original file:",
            compressionError
          );
          // Continue with original file if compression fails
        }
      }
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async function () {
        try {
          // Create an image element to properly load and process the image
          const img = new Image();

          img.onload = async function () {
            try {
              // Create a canvas for enhanced approach
              const canvas = document.createElement("canvas");
              const ctx = canvas.getContext("2d");

              // Calculate new dimensions - standard resize to 1200px width
              let targetWidth = img.width;
              let targetHeight = img.height;

              if (img.width > 1200) {
                targetWidth = 1200;
                targetHeight = (img.height * targetWidth) / img.width;
              }

              // Use same dimensions
              canvas.width = targetWidth;
              canvas.height = targetHeight;

              // Draw image
              ctx.fillStyle = "white";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

              // Apply enhanced contrast
              try {
                const imageData = ctx.getImageData(
                  0,
                  0,
                  canvas.width,
                  canvas.height
                );
                const data = imageData.data;

                // Apply advanced contrast enhancement
                for (let i = 0; i < data.length; i += 4) {
                  // Get RGB
                  const r = data[i];
                  const g = data[i + 1];
                  const b = data[i + 2];

                  // Convert to grayscale
                  const gray = 0.299 * r + 0.587 * g + 0.114 * b;

                  // Apply S-curve for contrast enhancement
                  // This provides better distinction between text and background
                  const contrast = 3; // Contrast multiplier
                  const midpoint = 128;

                  // Apply sigmoid function for contrast
                  let newVal =
                    255 / (1 + Math.exp((-contrast * (gray - midpoint)) / 128));

                  // Adjust to ensure black text on white background
                  newVal = newVal < 180 ? 0 : 255;

                  // Set new value
                  data[i] = data[i + 1] = data[i + 2] = newVal;
                }

                ctx.putImageData(imageData, 0, 0);
              } catch (err) {
                console.error("Error applying enhanced contrast:", err);
              }

              // Get processed image
              const processedImage = canvas.toDataURL("image/png", 0.8);

              // Run OCR with text line configuration
              const enhancedConfig = {
                tessedit_ocr_engine_mode: 3,
                tessedit_pageseg_mode: 7, // Treat the image as a single text line
                preserve_interword_spaces: 1,
                textord_min_linesize: 2.5, // Helps with small text
              };

              const result = await Tesseract.recognize(
                processedImage,
                "dan+eng",
                enhancedConfig
              );

              // Return result
              resolve({
                text: result.data.text,
                selectedMethod: "Enhanced",
                selectedConfidence: result.data.confidence,
              });
            } catch (error) {
              console.error("Error during OCR processing:", error);
              // Return empty result with error
              resolve({
                text: "",
                selectedMethod: "Error",
                selectedConfidence: 0,
                error: error.message,
              });
            }
          };

          img.onerror = function (err) {
            console.error("Image loading error:", err);
            resolve({
              text: "",
              selectedMethod: "Error",
              selectedConfidence: 0,
              error: "Image loading failed",
            });
          };

          // Set image source from FileReader result
          img.src = reader.result;
        } catch (error) {
          console.error("OCR preprocessing error:", error);
          resolve({
            text: "",
            selectedMethod: "Error",
            selectedConfidence: 0,
            error: "Preprocessing failed",
          });
        }
      };

      reader.onerror = function (error) {
        console.error("FileReader error:", error);
        resolve({
          text: "",
          selectedMethod: "Error",
          selectedConfidence: 0,
          error: "FileReader failed",
        });
      };

      // Read the file as data URL
      reader.readAsDataURL(file);
    });
  } catch (error) {
    console.error("Top-level OCR error:", error);
    return {
      text: "",
      selectedMethod: "Error",
      selectedConfidence: 0,
      error: "Top-level error: " + error.message,
    };
  }
}
// Function to check if an image has EXIF data (likely from a mobile camera)
async function checkForExifData(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = function (e) {
      const arrayBuffer = e.target.result;

      try {
        // Create a temporary img element to use with EXIF.js
        const tempImg = document.createElement("img");

        tempImg.onload = function () {
          EXIF.getData(tempImg, function () {
            // Check if there's any EXIF data available
            const allTags = EXIF.getAllTags(this);
            const hasExifData = Object.keys(allTags).length > 0;

            // Look specifically for camera-related tags if available
            const hasCameraData =
              allTags.Make ||
              allTags.Model ||
              allTags.DateTimeOriginal ||
              allTags.Orientation;

            // // //// console.log("EXIF data detected:", hasExifData);
            if (hasExifData) {
              // // //// console.log("Camera-specific EXIF data:", hasCameraData);
            }

            // Consider the image from a mobile camera if it has any camera-specific EXIF data
            resolve(hasCameraData || hasExifData);
          });
        };

        tempImg.onerror = function () {
          console.error("Failed to load image for EXIF extraction");
          resolve(false);
        };

        // Create an Object URL from the file
        tempImg.src = URL.createObjectURL(file);
      } catch (error) {
        console.error("Error checking EXIF data:", error);
        resolve(false);
      }
    };

    reader.onerror = function () {
      console.error("FileReader error during EXIF check");
      resolve(false);
    };

    // Read the file as an ArrayBuffer for EXIF.js
    reader.readAsArrayBuffer(file);
  });
}

// Function to check if text content is meaningful (from original code)
function isTextMeaningful(text) {
  // Remove whitespace and check if we have substantial content
  const cleanText = text.trim().replace(/\s+/g, " ");
  return cleanText.length > 50; // Adjust threshold as needed
}

async function extractImagesFromPDFPage(page) {
  // Use a higher scale factor for better quality
  const scale = 2.0; // Increased from 1.0 to 2.0 for higher resolution
  const viewport = page.getViewport({ scale });

  // Create canvas with higher resolution
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // Use white background to ensure clean extraction
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Render page to canvas with higher quality settings
  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  // Apply image enhancement for better OCR (similar to mobile image processing)
  try {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Apply adaptive contrast enhancement specifically for text
    for (let i = 0; i < data.length; i += 4) {
      // Get RGB
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Convert to grayscale using the luminosity method
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // Apply adaptive thresholding for better text detection
      // Use different contrast levels based on pixel brightness
      let contrast = gray < 128 ? 2.5 : 3.5;
      const midpoint = 128;

      // Apply contrast curve
      let newVal = 255 / (1 + Math.exp((-contrast * (gray - midpoint)) / 128));

      // Apply stronger thresholding for likely text pixels
      if (Math.abs(gray - midpoint) < 60) {
        newVal = newVal < 160 ? 0 : 255;
      }

      // Set new value
      data[i] = data[i + 1] = data[i + 2] = newVal;
    }

    context.putImageData(imageData, 0, 0);
  } catch (err) {
    console.error("Error applying image enhancement to PDF page:", err);
  }

  // Return high quality image with better compression settings
  return canvas.toDataURL("image/png", 1.0); // Using highest quality (1.0)
}
// Original OCR function specifically for PDF images
async function processImageWithOCRForPDF(file) {
  // Handle both data URL and File object
  if (typeof file === "string") {
    try {
      const {
        data: { text },
      } = await Tesseract.recognize(file, "dan");
      return text;
    } catch (error) {
      console.error("OCR Error:", error);
      return "";
    }
  } else {
    // File object processing
    const reader = new FileReader();
    reader.readAsDataURL(file);
    return new Promise((resolve) => {
      reader.onload = async function () {
        try {
          const {
            data: { text },
          } = await Tesseract.recognize(reader.result, "dan");
          resolve(text);
        } catch (error) {
          console.error("OCR Error:", error);
          resolve("");
        }
      };
    });
  }
}

// Enhanced PDF processing function (using the original OCR method)
async function processEnhancedPDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pagesToParse = Math.min(pdf.numPages, 20);
    let combinedText = "";
    let usedOCR = false; // Track if OCR was used

    // First pass: Try to extract text from each page
    for (let i = 1; i <= pagesToParse; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");

      // If page has meaningful text, add it
      if (isTextMeaningful(pageText)) {
        combinedText += pageText + "\n\n";
        //// console.log(`Page ${i}: Used direct text extraction`);
      } else {
        // If page lacks meaningful text, extract and process images with OCR
        usedOCR = true; // Set flag that OCR was used
        //// console.log(`Page ${i}: Using OCR (no meaningful direct text found)`);

        try {
          const imageData = await extractImagesFromPDFPage(page);

          if (imageData) {
            //// console.log(`Extracted image data from page ${i}, processing with OCR`);

            // Use the enhanced OCR configuration similar to mobile images
            const enhancedConfig = {
              tessedit_ocr_engine_mode: 3,
              tessedit_pageseg_mode: 6, // Assume a single uniform block of text
              preserve_interword_spaces: 1,
              textord_min_linesize: 2.5,
              tessedit_char_whitelist:
                "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZæøåÆØÅ0123456789.,;:!?(){}[]<>@#$%^&*+=-_'\"`~§°€/\\|",
            };

            const {
              data: { text },
            } = await Tesseract.recognize(imageData, "dan", enhancedConfig);

            if (text && isTextMeaningful(text)) {
              //// console.log(`OCR extracted meaningful text from page ${i}`);
              combinedText += text + "\n\n";
            } else {
              //// console.log(`OCR failed to extract meaningful text from page ${i}`);

              // Try one more time with different settings if first attempt failed
              const fallbackConfig = {
                tessedit_ocr_engine_mode: 3,
                tessedit_pageseg_mode: 3, // Assume text as columns
              };

              try {
                const fallbackResult = await Tesseract.recognize(
                  imageData,
                  "dan",
                  fallbackConfig
                );

                if (
                  fallbackResult.data.text &&
                  isTextMeaningful(fallbackResult.data.text)
                ) {
                  //// console.log(`Fallback OCR extracted meaningful text from page ${i}`);
                  combinedText += fallbackResult.data.text + "\n\n";
                }
              } catch (fallbackError) {
                console.error(
                  `Fallback OCR failed for page ${i}:`,
                  fallbackError
                );
              }
            }
          }
        } catch (imgError) {
          console.error(`Error processing images on page ${i}:`, imgError);
        }
      }
    }

    // Post-process the text to clean up OCR artifacts
    combinedText = combinedText
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(/([.!?])\s*(?=[A-ZÆØÅ])/g, "$1\n\n") // Add paragraph breaks after sentences
      .trim();

    // Check final text length
    if (combinedText.length > 24000) {
      combinedText = combinedText.substring(0, 24000);
    }

    // Return both text and OCR usage info
    return {
      text: combinedText.trim(),
      usedOCR: usedOCR,
    };
  } catch (error) {
    console.error("Enhanced PDF processing error:", error);
    throw new Error("Der opstod en fejl under behandling af PDF-filen.");
  }
}

// Function to handle OCR improvement call

async function processDOCXFile(file) {
  try {
    // Set limit for approximately 5 pages (2,500 characters per page)
    const FIVE_PAGE_LIMIT = 20000;

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async function (e) {
        try {
          const arrayBuffer = e.target.result;

          // Add style mapping to properly detect headings
          const options = {
            styleMap: [
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
              "p[style-name='Title'] => h1:fresh",
              "p[style-name='Subtitle'] => h2:fresh",
            ],
          };

          const result = await mammoth.convertToHtml({ arrayBuffer }, options);
          //// console.log("this is result", result);

          let content = result.value;
          //// console.log("this is result", content);

          // Check if content needs to be limited
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = content;
          const plainTextLength = (
            tempDiv.textContent ||
            tempDiv.innerText ||
            ""
          ).length;

          if (plainTextLength > FIVE_PAGE_LIMIT) {
            // Limit HTML content while preserving structure
            content = limitHtmlContent(content, FIVE_PAGE_LIMIT);
            //// console.log(`DOCX content limited to approximately 5 pages (from ${plainTextLength} to ~${FIVE_PAGE_LIMIT} characters)`);
          }

          resolve(content.trim());
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  } catch (error) {
    console.error("DOCX processing error:", error);
    throw new Error("Error processing Word document");
  }
}

// Helper function to limit HTML content while preserving structure
function limitHtmlContent(htmlContent, characterLimit) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, "text/html");
  const body = doc.body;

  let characterCount = 0;
  let result = "";

  // Function to traverse nodes and build limited HTML
  function traverseAndLimit(node) {
    if (characterCount >= characterLimit) {
      return false; // Stop processing
    }

    if (node.nodeType === Node.TEXT_NODE) {
      // Text node - add characters until limit
      const text = node.textContent;
      const remainingChars = characterLimit - characterCount;

      if (text.length <= remainingChars) {
        // Add all text
        result += text;
        characterCount += text.length;
        return true;
      } else {
        // Add partial text, try to break at word boundary
        let truncatedText = text.substring(0, remainingChars);
        const lastSpace = truncatedText.lastIndexOf(" ");

        if (lastSpace > remainingChars * 0.8) {
          // Break at word boundary if it's not too far back
          truncatedText = text.substring(0, lastSpace);
        }

        result += truncatedText;
        characterCount += truncatedText.length;
        return false; // Reached limit
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Element node - add opening tag, process children, add closing tag
      const tagName = node.tagName.toLowerCase();
      const attributes = Array.from(node.attributes)
        .map((attr) => `${attr.name}="${attr.value}"`)
        .join(" ");

      // Add opening tag
      result += `<${tagName}${attributes ? " " + attributes : ""}>`;

      // Process children
      let continueProcessing = true;
      for (const child of node.childNodes) {
        continueProcessing = traverseAndLimit(child);
        if (!continueProcessing) break;
      }

      // Add closing tag (only if not self-closing)
      const selfClosingTags = ["br", "hr", "img", "input", "meta", "link"];
      if (!selfClosingTags.includes(tagName)) {
        result += `</${tagName}>`;
      }

      return continueProcessing;
    }

    return true;
  }

  // Process all child nodes of body
  for (const child of body.childNodes) {
    const continueProcessing = traverseAndLimit(child);
    if (!continueProcessing) break;
  }

  return result;
}
// Modified OCRImproveCall function to handle the upload button state properly
function OCRImproveCall(text) {
  // Show loading state (loader should already be true, but ensuring consistency)
  showLoader(".textarea-wrapper", "Uploader tekst...");
  uploadImg.disabled = true;

  // Prepare form data
  const formData = new FormData();
  formData.append("action", "korrektur_OCR_v1");
  formData.append("text", text);
  formData.append("translateTo", getLanguageName(currentLanguage));

  // Send request
  fetch(SB_ajax_object.ajax_url, {
    method: "POST",
    credentials: "same-origin",
    body: new URLSearchParams(formData),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        const translatedContent = data.data;
        displayResponse(translatedContent);
        setTimeout(() => scrollAfterPaste(), 100);
        uploadImg.disabled = true; // Keep disabled after successful processing
      } else {
        throw new Error(data.data?.message || "Translation failed");
      }
    })
    .catch((error) => {
      console.error("Translation request failed:", error);
      // Show error message to user
      alert("Der er et problem med dit internet. Prøv igen.");
    })
    .finally(() => {
      hideLoader(".textarea-wrapper");
      uploadImg.disabled = false;
    });
}

function formatExtractedText(text) {
  // Collapse multiple newlines to just one
  text = text.replace(/\n+/g, "\n");

  // Normalize different bullet characters to standard •
  text = text.replace(/[●○]/g, "•");

  // Add newlines before bullets and numbers
  text = text.replace(/(•|\d+\.)\s*/g, "\n$1 ");

  // Ensure space after bullets
  text = text.replace(/(•|\d+\.)([^\s])/g, "$1 $2");

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  // Add single newline after punctuation + capital letter (fix from before)
  text = text.replace(/([.!?])([A-ZÆØÅ])/g, "$1\n$2");

  return text.trim();
}

function displayPDF(text) {
  //// console.log('--- Raw Text with \\n markers ---');
  //// console.log(text.replace(/\n/g, '\\n\n'));
  //// console.log('--------------------------------');
  // Quill will treat \n as new lines, and automatically append one if missing
  quill1.setText(text);
}

// ! =============================================== new TTS =================================
let audio;
let isSpeaking = false;
let isLoading = false;
let audioBlob = null;
let selectedGender = "female"; // Default gender

document.addEventListener("DOMContentLoaded", function () {
  // console.log('DOM Content Loaded - Initializing TTS features');

  // Make sure we have the read button
  const readBtn = document.getElementById("readBtn");
  if (!readBtn) {
    console.error("Read button not found in the DOM");
    return; // Exit if button not found
  }

  // console.log('Read button found:', readBtn);

  // Create gender selection dropdown
  createGenderSelector();

  // Create audio controls
  createAudioControls();

  // Remove any existing click listeners to avoid duplicates
  const newReadBtn = readBtn.cloneNode(true);
  readBtn.parentNode.replaceChild(newReadBtn, readBtn);

  // Add click event listener to the read button
  newReadBtn.addEventListener("click", function (e) {
    // console.log('Read button clicked');

    if (isLoading) {
      // console.log('Currently loading - canceling fetch');
      cancelFetch();
    } else if (isSpeaking) {
      // console.log('Currently speaking - pausing playback');
      pauseSpeaking();
    } else if (audioBlob) {
      // console.log('Audio already fetched - resuming playback');
      resumeSpeaking();
    } else {
      // console.log('Showing gender selection dropdown');
      showGenderSelector();

      // Ensure the dropdown is visible
      setTimeout(() => {
        const selector = document.getElementById("genderSelector");
        if (selector) {
          // console.log('Gender selector display state:', selector.style.display);

          // Force show if needed
          if (selector.style.display !== "block") {
            selector.style.display = "block";
          }

          // Make the options clickable
          const maleOption = document.getElementById("maleOption");
          const femaleOption = document.getElementById("femaleOption");

          if (maleOption) {
            // console.log('Found male option, ensuring click handler');
            maleOption.onclick = function (event) {
              // console.log('Male option clicked');
              event.stopPropagation();
              selectedGender = "male";
              hideGenderSelector();
              safeTextToSpeech();
            };
          }

          if (femaleOption) {
            // console.log('Found female option, ensuring click handler');
            femaleOption.onclick = function (event) {
              // console.log('Female option clicked');
              event.stopPropagation();
              selectedGender = "female";
              hideGenderSelector();
              safeTextToSpeech();
            };
          }
        }
      }, 100); // Short delay to ensure DOM updates
    }
  });

  // console.log('TTS initialization complete');
});

function createGenderSelector() {
  // Remove any existing selector first to avoid duplicates
  const existingSelector = document.getElementById("genderSelector");
  if (existingSelector) {
    existingSelector.remove();
  }

  // Create the dropdown container
  const genderSelector = document.createElement("div");
  genderSelector.id = "genderSelector";
  genderSelector.className = "gender-selector";
  genderSelector.style.display = "none";
  genderSelector.style.position = "absolute";
  genderSelector.style.backgroundColor = "#fff";
  genderSelector.style.border = "1px solid #B3B3B3";
  genderSelector.style.borderRadius = "4px";
  genderSelector.style.zIndex = "1000";
  genderSelector.style.top = "100%"; // Position right below the parent element
  genderSelector.style.left = "50%"; // Center horizontally
  genderSelector.style.transform = "translateX(-50%)"; // Adjust to center precisely
  genderSelector.style.marginTop = "5px"; // Small gap between button and dropdown

  // Create the male option with ID for easier selection
  const maleOption = document.createElement("div");
  maleOption.id = "maleOption"; // Add explicit ID
  maleOption.className = "gender-option";
  maleOption.style.padding = "8px 15px";
  maleOption.style.cursor = "pointer";
  maleOption.style.display = "flex";
  maleOption.style.alignItems = "center";
  maleOption.style.justifyContent = "space-between";
  maleOption.style.backgroundColor = "#CDE5FF";
  maleOption.style.marginBottom = "8px";

  const maleIcon = document.createElement("span");
  maleIcon.className = "gender-icon-divs";
  maleIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 327.54 512">
                        <path fill="#bcbc50" d="M199.17,340.98c1.63.31,3.26.66,4.84,1.14s3.11.97,4.52,1.71c21.22,11.18,42.48,22.42,63.43,34.08,12.64,7.04,25.15,14.25,37.4,21.95,7.29,4.58,20.58,23.21,17.81,32.12-30.31,39.21-72.06,65.4-120.81,75.68l-24.19,4.31h-3c-1.58-.79-3.41-.8-5,0h-2c-1.58-.79-3.41-.8-5,0h-12c-2.24-.84-4.76-.84-7,0-.98-.07-2.02.09-3,0-56.19-5.33-111.08-36.41-145-81-1.18-5.77,4.24-13.64,7.74-18.64,4.46-6.39,9.76-12.06,16.27-16.44l102.97-56.09,2.02,1.18,2.05,1.36c-2.46,52.93,68.51,52.88,65.69-.04l2.26-1.32Z"/>
                        <path fill="#343c4a" d="M188.17,0c4.08,1.59,8.31,2.35,12.36,4.14,29.91,13.24,28.98,50.96,75.13,46.84,8.01-.72,31.17-9.42,36.25,7.25,9.92,4.25.02,24.41-3.56,30.93-6.01,10.95-19.64,27.3-29.17,35.33l-1.63,3.9c-42.23,33.93-96.92,15.5-140.65-4.52-27.62-13.47-54.43-7.2-71.06,19.22-2.71,4.08-5.6,5.55-8.66,4.39-2.49,1.13-7.36-2.4-7.73-4.45-.11-.6,2.58.26-.27,1.45C-5.06,81.12,38.96-10.7,112.37,3.3c7.8,1.49,20.63,8.82,26.31,8.79,5.19-.03,10.01-4.68,14.97-6.11l19.52-5.98h15Z"/>
                        <path fill="#dbd69c" d="M155.17,511.97h-7c1.26-1.65,5.74-1.65,7,0Z"/>
                        <path fill="#c3c464" d="M172.17,511.97h-5c.66-1.58,4.34-1.58,5,0Z"/>
                        <path fill="#dbd79d" d="M179.17,511.97h-5c.66-1.58,4.34-1.58,5,0Z"/>
                        <path fill="#243046" d="M57.17,132.99l2.61-.5c6.19,5.65,12.86,10.51,20.04,14.57,57.43.41,114.85.06,172.25-1.05l24.73-19.7,2.38.68v6c1.97,4.64,1.97,9.36,0,14l-1.66,3.79c-4.74,3.81-9.57,7.38-14.5,10.7l.37,28.53c-1.38,26.54-9.2,35.05-36.27,37.23-15.87,1.28-37.61,1.54-49.23-10.29-2.74-2.79-9.51-10.68-5.73-13.46-.77,0-1.96-.18-2-.68-.69-8.47-1.14-28.65,0-36.63l2-1.19c-1.65,3.28-14.06,3.13-16,0,.78,0,1.97.19,2,.68.34,5.44,1.02,33.28,0,36.63l-2,1.19c.88.2,1.85.7,1.82,1.5-.16,4.18-9.25,14.61-12.91,16.88-9.19,5.68-27.64,5.76-38.41,5.47-43.4-1.19-42.85-21.19-41.05-58.09.88-5.54-.75-9.46-4.87-11.75-5.16-2.79-9.02-6.29-11.57-10.51-2.87-4.33-2.94-9.7,0-14,.02-1-.06-2.01,0-3,.05-.91-.48-2.76.49-2.99,2.55,1.94,4.96,4.07,7.51,5.99Z"/>
                        <path fill="#fecebe" d="M279.17,109.99v17l-26.62,20.87c-57.26,2.64-115.35.33-172.92,1.17-4.45-.61-17.82-12.55-22.46-16.04,6.68-2.86,9.41-9.59,13.97-14.52,34.07-36.8,65.26-8.13,103.26,3.79,37.49,11.76,72.86,14.6,104.76-12.26Z"/>
                        <path fill="#feb09e" d="M317.17,162.99c.48,2.64.82,5.38,0,8-2.74,17.82-11.15,26.71-29,30l-8.45.54c-1.58,1.43-2.12.52-2.55-1.45v-49.65s2.01-3.44,2.01-3.44c0-4.65,0-9.35,0-14,20.37-.47,34.11,10.03,38,30Z"/>
                        <path fill="#dece96" d="M318.17,167.99c-.07,1.75-.93,2.51-1,3v-8c.33,1.71,1.11,2.16,1,5Z"/>
                        <path fill="#feb09e" d="M49.17,132.99c-.08,4.65.02,9.35,0,14,2.2,17.59,2.81,35.28,1.83,53.09-.61,1.37-2.22,2-4.83,1.91-19.9-.72-32.25-11.46-35-31-.83-2.62-.47-5.36,0-8,.21-1.23-.19-2.69.23-4.22,4.73-16.83,20.48-27.1,37.77-25.78Z"/>
                        <path fill="#dece96" d="M11.17,170.99c-.06-.45-.95-1.24-1-3-.08-2.83.72-3.37,1-5v8Z"/>
                        <path fill="#feb09e" d="M198.17,314.98l1,26c-1.85,9.45.17,15.59-4.61,24.89-13.1,25.47-51.16,23.7-62.12-2.66-2.43-5.84-3.08-16.01-3.27-22.23-.04-1.17.96-2.84.94-4.51-.09-7.17-.49-14.31.06-21.49l4.61-.74c19.22,5.26,39.57,5.25,58.79,0l4.6.74Z"/>
                        <path fill="#fecebe" d="M49.17,146.99c2.85,1.87,16.61,11.17,17.51,12.99,2.23,4.54-.41,32.49.94,41.06s6.68,16.76,14.51,20.49c11.03,5.24,50.62,5.43,61.18-.89,4.14-2.48,12.86-12.48,12.86-17.14v-38.5h16v38.5c0,4.51,8.34,14.17,12.25,16.75,9.34,6.15,34.75,5.59,46.29,4.79,39.13-2.71,29.07-35.95,30.62-64.38l17.84-13.66v54s9,0,9,0c-2.79.51-5.54,1.75-9,1,1.18,51.66-31.87,97.78-81,113-22.4,6.94-45.57,6.97-68,0-49.15-15.27-82.16-61.3-81-113-1-.04-2,.04-3,0l3.08-2.44c-.08-17.52-.17-35.06-.08-52.56Z"/>
                        <rect fill="#343c4a" x="83.17" y="164.99" width="58" height="14"/>
                        <rect fill="#343c4a" x="187.17" y="164.99" width="58" height="14"/>
                        <path fill="#343c4a" d="M83.18,193.99l56.37.24c4.8,1.78-.82,13.26-7.11,14.53-6.22,1.26-31.89,1.01-38.77.23-8.4-.96-11.62-6.97-10.49-15Z"/>
                        <path fill="#343c4a" d="M245.16,193.99c1.33,7.76-2.38,14.05-10.47,15.02-6.61.79-32.78.96-38.79-.25-6.3-1.27-11.92-12.78-7.09-14.58l56.36-.18Z"/>
                        <path fill="#feb09e" d="M188.82,245.28c6.44-.35,9.14,6.1,6.84,11.69-5.63,13.69-24.96,21.13-38.85,17.97-9.06-2.06-30.01-14.28-23.69-25.5,6.54-11.62,16.27,6.1,22.36,8.74,8.17,3.54,16.79,1.88,23.23-4.14,3.17-2.96,4.92-8.47,10.11-8.75Z"/>
                        </svg>`;

  const maleText = document.createElement("span");
  maleText.textContent = "Mads";

  maleOption.appendChild(maleIcon);
  maleOption.appendChild(maleText);

  // Create the female option with ID for easier selection
  const femaleOption = document.createElement("div");
  femaleOption.id = "femaleOption"; // Add explicit ID
  femaleOption.className = "gender-option";
  femaleOption.style.padding = "8px 15px";
  femaleOption.style.cursor = "pointer";
  femaleOption.style.display = "flex";
  femaleOption.style.alignItems = "center";
  femaleOption.style.justifyContent = "space-between";
  femaleOption.style.backgroundColor = "#FFCED9";

  const femaleIcon = document.createElement("span");
  femaleIcon.innerHTML = `<svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 244 383.39">
                                    <g>
                                        <path fill="#6c7fd7" d="M51.65,265.87c.62-.41,1.26-.78,1.94-1.06,3.53-1.45,20.39-.72,25.57-.36,1.41.1,2.71.76,3.93,1.43l-1.76,1.82c-8.96.38-17.91.61-26.87.7l18.15,53.93,1.49,1.36c10.56,2.05,12.16,6.88,5.66,15.35l-.2,2,23.1,40.84-.87,1.51H10.48l-.03-79.75c1.23-18.76,16.66-35.05,35.21-37.77.18-.67.43-.65.75,0,1.69.55,3.56.66,5.24,0Z"/>
                                        <path fill="#6c7fd7" d="M216.33,383.39h-74.11l-.97-1.33,23.22-41.1-.32-2.15c-7.26-9.45-3.55-12.8,6.5-15.53,5.67-16.59,11.55-33.2,17.63-49.81l2.59-4.6c5.36-1.01,12.1,5.2,15.75,9.2,6.76,7.4,10.5,17.04,11.22,26.99l-.02,77.43-1.5.91Z"/>
                                        <path fill="#8694dd" d="M180.4,266.62c3.74-.87,16.16-1.2,10.48,2.25-5.99,18.04-12.3,36-18.13,54.1-1.93,4.16-9.43,2.29-10.76,6.5-1.44,4.55,5.21,7.65,3.87,12.03l-23.64,41.9h-11.98c.29-3.88.61-7.79,1.54-11.58,3.67-14.99,7.46-30,11.4-44.92.49-1.87,1.18-3.68,1.89-5.5s1.54-3.6,2.38-5.37l-.83-2.75c4.75-14.9,8.68-29.98,11.78-45.26l1.78-2.14,1.33-1.04c5.84-.26,11.72-.19,17.65.2l1.23,1.59Z"/>
                                        <path fill="#8694dd" d="M96.56,316.02c.85,1.77,1.67,3.55,2.38,5.37s1.4,3.63,1.89,5.5c3.93,14.92,7.73,29.93,11.4,44.92.93,3.79,1.25,7.69,1.54,11.58h-11.98l-23.64-41.9c-1.33-4.37,5.32-7.48,3.87-12.03s-8.84-2.45-10.76-6.5l-18.87-55.99c10.11-1.31,20.85.84,30.68-1.11.21-.65.46-.64.75,0l1.76,2.06c3.1,15.33,7.03,30.47,11.82,45.41l-.85,2.68Z"/>
                                        <path fill="#d4d9f2" d="M147.46,316.02c-5.68,22.46-11.15,45.01-17.22,67.37h-16.47c-6.07-22.36-11.54-44.9-17.22-67.37l.7-1.5h49.29l.91,1.5Z"/>
                                        <path fill="#4f66cf" d="M192.37,265.87l3.74.75c.2-2.08.96-2.47,2.25-.75,3.96,1.26,8.08,1.78,11.96,3.38,12.5,5.18,22.84,18.57,24,32.15l-.03,81.99h-17.96l.03-78.25c-1.2-16.26-10.34-30.03-25.48-36.28.25-.75.35-1.53.75-2.24-3.73-.12-7.5.14-11.23,0-1.1-1.13-.69-1.54.75-.75l10.29-1.48.94,1.48Z"/>
                                        <path fill="#5a5a5a" d="M116.77.14c2.44.6,5.04.63,7.49,0,2.59.01,6.26-.63,8.23.75-.11.74-1.08.45-1.02.45,11.12,1.37,19.75,2.71,30.17,7.38,26.96,12.11,49.61,37.85,56.23,66.85,1.68,7.38,5.34,33.73,1.88,39.18-.33.51-.74.97-1.18,1.41-.81,2.07-6.08,2.26-6.74,0-4.74,2.17-11.84,2.35-16.47,0-15.99,2.29-33.48,2.71-49.4,0-34.78.26-66.09-26.33-69.45-61.82-.71-.56-9.22,6.66-10.57,7.91l-2.32.02-1.32,3.14c-14.11,12.61-23.91,29.28-27.37,47.94l-2,2.81-1.4,1.47c-5.63-.42-10.84,1.65-15.83,3.89l-1.48-.87c3.09-12.03,3.13-24.7,5.46-36.83C28.66,37.15,69.42,2.51,116.77.14Z"/>
                                        <path fill="#5a5a5a" d="M32.93,177.54l1.93,2.29c5.36,26.57,23.13,50.25,47.28,62.6l1.69,2.47c2.43,4.17,2.19,11.4,0,15.72,2.07,1.01,2.18,4.36,0,5.24h-.75c-10.45.31-21-.41-31.44,0-1.66.67-3.57.57-5.24,0-.25.03-.51-.04-.75,0-18.49-2.01-35.48-14.84-42.28-32.2-8.65-22.11,1.86-45.58,3.35-68.1l.8-.6c6.81,5.4,14.14,11.08,23.71,11.07l1.7,1.5Z"/>
                                        <path fill="#444" d="M237.29,168.56c-.58,17.55,9.1,35.63,5.77,54.8-4.16,23.93-21.74,38.02-44.69,42.51-.63.12-1.33.63-2.25.75l-3.74-.75c-3.28-.05-8.21-.44-11.23,0l1.83-1.91c28.12-6.13,45.3-32.35,39.8-60.55l-3.96-24.33,1.25-2.29.66-1.7c5.31-1.44,9.85-3.96,13.38-8.16,2.37-1.85,2.97-1.13,3.18,1.63Z"/>
                                        <path fill="#f79480" d="M218.57,116.16c1.77-2.69,9.63.68,10.48,3.74,13.9,8,18.51,25.81,12.12,40.19-1.51,3.39-3.75,4.43-3.89,8.46-1.16-1.17-.17-2.04-1.87-.75s-2.77,3.09-4.63,4.36c-2.87,1.97-7.31,3.88-10.72,4.63-.83,2.66-6.91,3.19-8.23.75-2.01-1.78-.67-8.16,1.5-9.36-.59-.06-1.48-.27-1.5-.69-.45-11.45-.84-26.54,0-37.8-.47-2.3.03-3.7,1.5-4.18-2.48,0-3.59-8.18-1.5-9.36,2.17.07,4.68-.25,6.74,0Z"/>
                                        <path fill="#fea68e" d="M32.93,116.16l1.35,1.09-1.33,10.55-1.51.72c.59.06,1.48.27,1.5.69.46,11.07.46,24.02,0,35.1l-1.5.89,1.53,1,1.32,10.35-1.36,1c-7.58.21-14.99-2.54-20.9-7.17-.97-.76-4.77-4.08-5.3-4.8-9.82-13.36-6.14-35.46,7.49-44.91,1.72-1.2,8.93-3.75,11.19-4.15,2.54-.46,4.98-.38,7.52-.34Z"/>
                                        <path fill="#444" d="M132.49.89c7.46-.15,16.17,1.87,23.37,3.96,39.67,11.5,69.8,45.88,72.44,87.75.57,9.07-.95,18.37.76,27.31-2.59-1.49-7.54-3.38-10.48-3.74,1.64-12.54.82-26.5-1.86-38.93C208,36.84,169.71,4.54,128.75,1.63c-.05-1.35,2.8-.72,3.74-.74Z"/>
                                        <path fill="#4b4b4b" d="M124.26.14c-1.66,1.28-5.97,1.24-7.49,0,2.47-.12,5.01-.01,7.49,0Z"/>
                                        <path fill="#9aa2c3" d="M51.65,265.87c-.95,1.24-4.29,1.24-5.24,0,1.64-.18,3.53.07,5.24,0Z"/>
                                        <path fill="#fea68e" d="M160.19,260.63c2.2.7,2.33,4.71,0,5.24-1.63,15.01-8.89,34.99-12.73,50.15h-50.9c-3.81-15.05-11.18-35.3-12.73-50.15-.17-1.65.06-3.53,0-5.24l3.53-.22c22.96,8.69,48.44,8.65,70.88-.82l1.95,1.04Z"/>
                                        <path fill="#5a5a5a" d="M220.07,176.79c2.02,19.76,9.3,37.07,1.63,56.65-6.78,17.33-22.46,29.03-40.56,32.43-.35.05-.67.39-.75.75-2.78-.11-5.34-.8-7.86-.82-3.91-.03-8.4,2.14-12.35.07.18-1.64-.06-3.53,0-5.24-2.25-4-2.42-11.78,0-15.72l1.93-2.56c24.7-12.1,42.41-35.31,47.74-62.28l1.98-2.53c2.62.05,5.69-.2,8.23-.75Z"/>
                                        <path fill="#8694dd" d="M196.12,266.62c-1.1.14-3.2.32-3.74-.75,1.2.02,3.11-.45,3.74.75Z"/>
                                        <path fill="#fecdbe" d="M145.96,116.16c16.44.34,32.96-.15,49.4,0,1.71.84,2.14,5.22,2.24,7.26.9,18.37,2.01,41.72-2.06,59.56-8.5,37.31-42.89,70.77-82.52,69.41-.44.33-.89.64-1.38.85-3.06,1.34-25.06-4.2-27.04-6.9-.32-.43-.56-.93-.77-1.44-26.18-12.05-46.36-38.95-50.9-67.37-.52-3.26-1.5-9.47-1.5-12.35v-36.68c0-3.02.98-8.98,1.5-12.35,3.37-21.83,14.19-39.89,30.69-53.89l2.05,1.96c10.3,36.49,44.8,51.55,80.29,51.93Z"/>
                                        <path fill="#feaf9d" d="M211.84,116.16l1.5,9.36v42.67c0,2.06-1.1,6.97-1.5,9.36-4.96,29.74-24.23,54.95-51.65,67.37-5.18,5.38-15.35,7.28-22.89,8.46s-17.71,2.47-24.27-.97c44.4-2.33,80.56-40.05,83.12-84.17.77-13.22.68-30.97,0-44.23-.13-2.6-1.24-5.14-.78-7.83,5.47.05,11.01-.19,16.47,0Z"/>
                                        <path fill="#feaf9d" d="M145.96,116.16c-9.24-.19-17.79-.04-26.97-1.85-26.62-5.24-49.07-25.48-55.37-52.05,4.49-3.81,8.76-7.93,14.21-10.48,1.51,30.39,24.83,54.94,53.75,61.91l14.38,2.47Z"/>
                                        <path fill="#f79480" d="M113.03,252.4c16.51,1.71,31.87-.56,47.16-7.49-.11,5.22.17,10.77,0,15.72-4.14.94-7.88,2.95-11.98,4.12-21.29,6.06-43.99,4.26-64.37-4.12-.19-5.19.14-10.5,0-15.72,8.81,4.05,19.55,6.49,29.19,7.49Z"/>
                                        <path fill="#fea698" d="M102.35,183.64c7.59-1.38,6.3,9.41,8.84,13.32,5.73,8.81,20.1,7.72,23.91-2.22,1.59-4.16.12-10.48,6.18-11.06,10.13-.97,5.6,14.45,2.32,19.56-10.51,16.4-36.46,14.42-43.93-3.73-1.91-4.65-4.61-14.54,2.69-15.87Z"/>
                                        <path fill="#5a5a5a" d="M175.69,150.38c-.84.75-2.6.56-2.82,1.45-1.09,4.41,2.64,16.28-5.58,16.79-2.54.16-4.73-1.03-5.67-3.38-1.11-2.77-1.09-15.35-.71-18.79,1.43-12.94,24.02-4.35,14.78,3.92Z"/>
                                        <path fill="#5a5a5a" d="M72.49,151.45c-.53-.59-3.71-.15-4.36-3.49-1.97-10.2,13.19-9.53,15.31-4.83.63,1.4.77,19.17.37,21.3-.86,4.56-8.56,5.84-10.65.95-1.32-3.1.08-13.09-.68-13.93Z"/>
                                        <path fill="#fd8f83" d="M79.12,179.25c2.87,3.41,1.11,9.12-3.3,10.11-2.45.55-15.2.54-17.65,0-5.55-1.24-6.14-10.28,0-11.66,2.67-.6,14.12-.56,17.09-.19,1.16.14,3.14.89,3.86,1.74Z"/>
                                        <path fill="#fd8f83" d="M164.9,179.25c.72-.85,2.7-1.6,3.86-1.74,2.97-.37,14.42-.41,17.09.19,6.14,1.38,5.54,10.42,0,11.66-2.45.55-15.2.55-17.65,0-4.41-.98-6.17-6.7-3.3-10.11Z"/>
                                    </g>
                                    </svg>`;

  const femaleText = document.createElement("span");
  femaleText.textContent = "Sofie";

  femaleOption.appendChild(femaleIcon);
  femaleOption.appendChild(femaleText);

  // Add options to selector
  genderSelector.appendChild(maleOption);
  genderSelector.appendChild(femaleOption);

  // Create a container that will hold both the read button and the dropdown
  const readBtn = document.getElementById("readBtn");
  if (readBtn) {
    // Make the read button's parent position relative
    const parentElement = readBtn.parentNode;
    parentElement.style.position = "relative";

    // Add the gender selector to the parent
    parentElement.appendChild(genderSelector);
  } else {
    document.body.appendChild(genderSelector);
  }

  // Add event listeners AFTER appending to DOM
  maleOption.onclick = function (e) {
    // console.log('Male option clicked');
    e.stopPropagation(); // Prevent the click from bubbling up
    selectedGender = "male";
    hideGenderSelector();
    safeTextToSpeech();
  };

  femaleOption.onclick = function (e) {
    // console.log('Female option clicked');
    e.stopPropagation(); // Prevent the click from bubbling up
    selectedGender = "female";
    hideGenderSelector();
    safeTextToSpeech();
  };

  // Close dropdown when clicking outside
  document.addEventListener("click", function (event) {
    const selector = document.getElementById("genderSelector");
    const readButton = document.getElementById("readBtn");

    if (
      selector &&
      selector.style.display === "block" &&
      event.target !== selector &&
      event.target !== readButton &&
      !selector.contains(event.target) &&
      !readButton.contains(event.target)
    ) {
      hideGenderSelector();
    }
  });
}

function createAudioControls() {
  // Create audio controls container
  const audioControls = document.createElement("div");
  audioControls.id = "audioControls";
  audioControls.className = "audio-controls";
  audioControls.style.display = "none";
  audioControls.style.display = "none";
  audioControls.style.justifyContent = "center";
  audioControls.style.alignItems = "center";
  audioControls.style.backgroundColor = "#F6F6F6";
  audioControls.style.borderRadius = "7px";

  // Pause/Play button
  const pausePlayBtn = document.createElement("button");
  pausePlayBtn.id = "pausePlayBtn";
  pausePlayBtn.className = "control-btn";
  pausePlayBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="16" viewBox="0 0 30.46 37.79">
                                <rect fill="#7b7b7b" x="0" y="0" width="10.57" height="37.79" rx="5.09" ry="5.09"/>
                                <rect fill="#7b7b7b" x="19.89" y="0" width="10.57" height="37.79" rx="5.09" ry="5.09"/>
                                </svg>`;
  pausePlayBtn.style.border = "none";
  pausePlayBtn.style.width = "40px";
  pausePlayBtn.style.height = "40px";
  pausePlayBtn.style.cursor = "pointer";
  pausePlayBtn.style.display = "flex";
  pausePlayBtn.style.justifyContent = "center";
  pausePlayBtn.style.alignItems = "center";

  // Stop button
  const stopBtn = document.createElement("button");
  stopBtn.id = "stopBtn";
  stopBtn.className = "control-btn";
  stopBtn.innerHTML =
    '<svg width="13" height="14" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 278.25 278.25"><g> <rect width="278.25" height="278.25" rx="40" ry="40" style="fill: #7b7b7b;"/></g></svg>';

  stopBtn.style.border = "none";

  stopBtn.style.width = "40px";
  stopBtn.style.height = "40px";
  stopBtn.style.cursor = "pointer";
  stopBtn.style.display = "flex";
  stopBtn.style.justifyContent = "center";
  stopBtn.style.alignItems = "center";

  // Download button
  const downloadBtn = document.createElement("button");
  downloadBtn.id = "downloadBtn";
  downloadBtn.className = "control-btn";
  downloadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 383.22 381.87">
  <polyline points="283.37 180.62 191.09 272.9 98.81 180.62" fill="none" stroke="#7b7b7b" stroke-linecap="round" stroke-linejoin="round" stroke-width="42px"/>
  <line x1="190.75" y1="262.04" x2="190.75" y2="21" fill="none" stroke="#7b7b7b" stroke-linecap="round" stroke-miterlimit="10" stroke-width="42px"/>
  <path d="M362.22,276.13v20.07c0,35.72-28.96,64.68-64.68,64.68H85.68c-35.72,0-64.68-28.96-64.68-64.68v-20.07" fill="none" stroke="#7b7b7b" stroke-linecap="round" stroke-linejoin="round" stroke-width="42px"/>
</svg>`;

  downloadBtn.style.border = "none";

  downloadBtn.style.width = "40px";
  downloadBtn.style.height = "40px";
  downloadBtn.style.cursor = "pointer";
  downloadBtn.style.display = "flex";
  downloadBtn.style.justifyContent = "center";
  downloadBtn.style.alignItems = "center";

  // Add event listeners
  pausePlayBtn.addEventListener("click", function () {
    if (isSpeaking) {
      pauseSpeaking();
    } else {
      resumeSpeaking();
    }
  });

  stopBtn.addEventListener("click", function () {
    stopSpeaking();
  });

  downloadBtn.addEventListener("click", function () {
    downloadAudio();
  });

  // Add buttons to controls
  audioControls.appendChild(pausePlayBtn);
  audioControls.appendChild(stopBtn);
  audioControls.appendChild(downloadBtn);

  // Add controls to document near the read button - we'll replace the read button with this
  const readBtn = document.getElementById("readBtn");
  if (readBtn && readBtn.parentNode) {
    // Adding at the same level as the read button
    readBtn.parentNode.appendChild(audioControls);
  } else {
    document.body.appendChild(audioControls);
  }
}

function showGenderSelector() {
  const genderSelector = document.getElementById("genderSelector");

  if (genderSelector) {
    // Simply display the dropdown that's already properly positioned
    genderSelector.style.display = "block";

    // console.log('Gender selector shown with display:', genderSelector.style.display);
  } else {
    console.error("Gender selector not found");
  }
}

function hideGenderSelector() {
  const genderSelector = document.getElementById("genderSelector");
  if (genderSelector) {
    genderSelector.style.display = "none";
  }
}

function showAudioControls() {
  const audioControls = document.getElementById("audioControls");
  const readBtn = document.getElementById("readBtn");

  if (audioControls && readBtn) {
    // Hide the read button and show audio controls
    readBtn.style.display = "none";
    audioControls.style.display = "flex";
  }
}

function hideAudioControls() {
  const audioControls = document.getElementById("audioControls");
  const readBtn = document.getElementById("readBtn");

  if (audioControls && readBtn) {
    // Show the read button and hide audio controls
    audioControls.style.display = "none";
    readBtn.style.display = "flex";
  }
}

function safeTextToSpeech() {
  if (isLoading || isSpeaking) return;

  isLoading = true;
  toggleIcons("loading"); // Show loading icon

  try {
    if (!navigator.onLine) {
      throw new Error("No internet connection");
    }
    textToSpeech();
  } catch (error) {
    handleError(error);
  }
}

// Variable to hold the current fetch request
let currentFetch = null;

// function textToSpeech() {
//     const textInput = quill1.getText().trim();
//     let lang;

//     if (currentLanguage === 'da') {
//         lang = 'Danish';
//     } else if (currentLanguage === 'en') {
//         lang = 'English';
//     } else if (currentLanguage === 'ge') {
//         lang = 'German';
//     } else if (currentLanguage === 'fr') {
//         lang = 'French';
//     } else if (currentLanguage === 'es') {
//         lang = "Spanish"
//     }
//     else {
//         lang = 'English';
//     }

//     // Create an AbortController to cancel the fetch if needed
//     const controller = new AbortController();
//     const signal = controller.signal;
//     currentFetch = controller;
//     // console.log("selected gender", selectedGender);
//     jQuery.ajax({
//         url: SB_ajax_object.ajax_url,
//         type: 'POST',
//         data: {
//             action: 'secure_bots_tts',
//             nonce: SB_ajax_object.nonce,
//             text: textInput,
//             lang: lang,
//             gender: selectedGender // Make sure to send the selected gender
//         },
//         xhrFields: {
//             responseType: 'blob'
//         },
//         beforeSend: function (xhr) {
//             // Store the XHR object to potentially abort it
//             currentFetch.xhr = xhr;
//         },
//         success: function (audioData) {
//             currentFetch = null;
//             isLoading = false;
//             audioBlob = audioData;
//             playAudio(audioData);
//         },
//         error: function (jqXHR, textStatus, errorThrown) {
//             if (textStatus === 'abort') {
//                 // console.log('Request was cancelled');
//                 isLoading = false;
//                 currentFetch = null;
//                 toggleIcons('idle');
//             } else {
//                 handleError(new Error("Speech synthesis failed: " + textStatus));
//             }
//         }
//     });
// }
function textToSpeech() {
  // Get HTML content, apply removeHamDanTags, then extract text
  const htmlContent = quill1.root.innerHTML;
  const processedHtml = removeHamDanTags(htmlContent);
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = processedHtml;
  const textInput = tempDiv.textContent || tempDiv.innerText || "";
  const cleanTextInput = textInput.trim();

  let lang;

  if (currentLanguage === "da") {
    lang = "Danish";
  } else if (currentLanguage === "en") {
    lang = "English";
  } else if (currentLanguage === "ge") {
    lang = "German";
  } else if (currentLanguage === "fr") {
    lang = "French";
  } else if (currentLanguage === "es") {
    lang = "Spanish";
  } else {
    lang = "English";
  }

  // Create an AbortController to cancel the fetch if needed
  const controller = new AbortController();
  const signal = controller.signal;
  currentFetch = controller;
  // console.log("selected gender", selectedGender);
  jQuery.ajax({
    url: SB_ajax_object.ajax_url,
    type: "POST",
    data: {
      action: "secure_bots_tts",
      nonce: SB_ajax_object.nonce,
      text: cleanTextInput,
      lang: lang,
      gender: selectedGender, // Make sure to send the selected gender
    },
    xhrFields: {
      responseType: "blob",
    },
    beforeSend: function (xhr) {
      // Store the XHR object to potentially abort it
      currentFetch.xhr = xhr;
    },
    success: function (audioData) {
      currentFetch = null;
      isLoading = false;
      audioBlob = audioData;
      playAudio(audioData);
    },
    error: function (jqXHR, textStatus, errorThrown) {
      if (textStatus === "abort") {
        // console.log('Request was cancelled');
        isLoading = false;
        currentFetch = null;
        toggleIcons("idle");
      } else {
        handleError(new Error("Speech synthesis failed: " + textStatus));
      }
    },
  });
}

function cancelFetch() {
  if (currentFetch && currentFetch.xhr) {
    currentFetch.xhr.abort();
    currentFetch = null;
    isLoading = false;
    toggleIcons("idle");
  }
}

function playAudio(audioData) {
  const audioUrl = URL.createObjectURL(audioData);
  audio = new Audio(audioUrl);

  audio.onerror = handleError;
  audio.onended = stopSpeaking;

  audio
    .play()
    .then(() => {
      isSpeaking = true;
      toggleIcons("playing"); // Show pause icon
      showAudioControls();
      updatePausePlayButton();
    })
    .catch(handleError);
}

function pauseSpeaking() {
  if (audio) {
    audio.pause();
    isSpeaking = false;
    updatePausePlayButton();
    toggleIcons("paused");
  }
}

function resumeSpeaking() {
  if (audio) {
    audio
      .play()
      .then(() => {
        isSpeaking = true;
        updatePausePlayButton();
        toggleIcons("playing");
        showAudioControls(); // Make sure controls are visible
      })
      .catch(handleError);
  } else if (audioBlob) {
    playAudio(audioBlob);
  }
}

function stopSpeaking() {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio = null;
  }

  isSpeaking = false;
  toggleIcons("idle");
  hideAudioControls();
  audioBlob = null;
}

function downloadAudio() {
  if (audioBlob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(audioBlob);
    a.download = "text-to-speech.mp3";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

function updatePausePlayButton() {
  const pausePlayBtn = document.getElementById("pausePlayBtn");

  if (pausePlayBtn) {
    if (isSpeaking) {
      // Show pause icon
      pausePlayBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="16" viewBox="0 0 30.46 37.79">
  <rect fill="#7b7b7b" x="0" y="0" width="10.57" height="37.79" rx="5.09" ry="5.09"/>
  <rect fill="#7b7b7b" x="19.89" y="0" width="10.57" height="37.79" rx="5.09" ry="5.09"/>
</svg>`;
    } else {
      // Show play icon
      pausePlayBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="16"   viewBox="0 0 345.03 382.74">
  <path fill="#7b7b7b" d="M312.29,134.11L100.12,9.28C55.83-16.78,0,15.15,0,66.53v249.67c0,51.38,55.83,83.31,100.12,57.26l212.17-124.84c43.66-25.69,43.66-88.82,0-114.51Z"/>
</svg>`;
    }
  }
}

function handleError(error) {
  console.error(error.message);
  isLoading = false;
  isSpeaking = false;
  currentFetch = null;
  toggleIcons("idle");
  hideAudioControls();
}

function toggleIcons(state) {
  const volumeIcon = document.querySelector(".lucide-volume-2");
  const pauseIcon = document.querySelector(".lucide-pause");
  const loader = document.querySelector(".loader");
  const buttonText = document.querySelector("#readBtn span");

  switch (state) {
    case "loading":
      if (loader) loader.style.display = "inline-block";
      if (volumeIcon) volumeIcon.style.display = "none";
      if (pauseIcon) pauseIcon.style.display = "none";
      if (buttonText) buttonText.textContent = " Loader...";
      break;
    case "playing":
      if (loader) loader.style.display = "none";
      if (volumeIcon) volumeIcon.style.display = "none";
      if (pauseIcon) pauseIcon.style.display = "inline";
      if (buttonText) buttonText.textContent = " Stop";
      break;
    case "paused":
      if (loader) loader.style.display = "none";
      if (volumeIcon) volumeIcon.style.display = "inline";
      if (pauseIcon) pauseIcon.style.display = "none";
      if (buttonText) buttonText.textContent = " Continue";
      break;
    case "idle":
      if (loader) loader.style.display = "none";
      if (volumeIcon) volumeIcon.style.display = "inline";
      if (pauseIcon) pauseIcon.style.display = "none";
      if (buttonText) buttonText.textContent = "Læs højt";
      break;
  }
}
// This will detect page unload/navigation events
window.addEventListener("beforeunload", function () {
  // console.log('Page is being unloaded - stopping TTS');
  stopSpeaking(); // Stop any ongoing audio playback
});

// This handles cases when the browser tab becomes hidden
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "hidden") {
    // console.log('Page visibility changed to hidden - stopping TTS');
    stopSpeaking(); // Stop any ongoing audio playback
  }
});

// ! ================================ new STT ===============================
let microphoneInstances = {}; // Store microphone instances for each button
let socketInstances = {}; // Store socket instances for each button
let isListening = {}; // Store listening state for each button
let reconnectAttempts = {}; // Store reconnection attempts for each button
let shouldReconnect = {}; // Control reconnection for each button
const MAX_RECONNECT_ATTEMPTS = 3;

// Global variable to store cursor position for Quill inputText
let quillCursorPosition = null;

// Map buttons to their respective text areas
const buttonTextMap = {
  micButton1: "inputText",
  micButton2: "custom_rewrite_input",
};

// Server configuration
const SERVER_URL = "wss://tale-skrivsikkert.dk/stt-ws"; // Update to your actual server URL
const API_KEY = "stt-prod-a7f39d4e82c61b5c"; // Your API key from the server config

// Initialize event listeners when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  Object.keys(buttonTextMap).forEach((buttonId) => {
    const button = document.getElementById(buttonId);
    if (button) {
      // Special handling for Quill inputText button to prevent focus loss
      if (buttonTextMap[buttonId] === "inputText") {
        // Prevent default behavior and maintain focus
        button.addEventListener("mousedown", function (e) {
          e.preventDefault(); // Prevents focus loss

          // Store current cursor position before starting STT
          const selection = quill1.getSelection();
          if (selection) {
            quillCursorPosition = selection.index;
          } else {
            // If no selection, use current length - 1 (before the trailing newline)
            quillCursorPosition = quill1.getLength() - 1;
          }
        });

        button.addEventListener("click", function (e) {
          e.preventDefault();

          // Keep Quill focused
          quill1.focus();

          // Restore cursor position if we have one
          if (quillCursorPosition !== null) {
            quill1.setSelection(quillCursorPosition, 0);
          }

          // Call the toggle recording function
          toggleRecording(buttonId);
        });
      } else {
        // Standard click handler for other buttons
        button.addEventListener("click", () => toggleRecording(buttonId));
      }
    }
  });

  // Track cursor position changes in Quill for better insertion accuracy
  if (typeof quill1 !== "undefined") {
    quill1.on("selection-change", function (range, oldRange, source) {
      if (range) {
        quillCursorPosition = range.index;
      }
    });
  }
});

async function getMicrophone() {
  try {
    const userMedia = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    return new MediaRecorder(userMedia);
  } catch (error) {
    console.error("Error accessing microphone:", error);
    throw new Error("Unable to access microphone. Please check permissions.");
  }
}

async function openMicrophone(buttonId) {
  try {
    await connectToSpeechServer(buttonId);
    const microphone = microphoneInstances[buttonId];

    return new Promise((resolve, reject) => {
      const checkSocket = setInterval(() => {
        const socket = socketInstances[buttonId];
        if (socket && socket.readyState === WebSocket.OPEN) {
          clearInterval(checkSocket);
          microphone.start(500);
          microphone.ondataavailable = (e) => {
            if (socket && socket.readyState === WebSocket.OPEN) {
              try {
                socket.send(e.data);
                //console.log(`Sent audio chunk: ${e.data.size} bytes`);
              } catch (error) {
                console.error("Error sending audio data:", error);
                handleWebSocketError(buttonId);
              }
            }
          };
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkSocket);
        reject(new Error("Timeout waiting for WebSocket connection"));
      }, 10000);
    });
  } catch (error) {
    console.error("Error in openMicrophone:", error);
    throw error;
  }
}

async function closeMicrophone(buttonId) {
  shouldReconnect[buttonId] = false; // Prevent reconnection

  const microphone = microphoneInstances[buttonId];
  if (microphone) {
    if (microphone.state !== "inactive") {
      microphone.stop();
    }

    const tracks = microphone.stream?.getTracks();
    if (tracks) {
      tracks.forEach((track) => track.stop());
    }

    microphone.ondataavailable = null;
    microphone.onerror = null;
    microphone.onstop = null;

    //console.log(`Microphone instance for ${buttonId} stopped and media stream tracks released.`);
  }

  await closeWebSocketConnection(buttonId);
  delete microphoneInstances[buttonId];

  // Reset cursor position when microphone closes for inputText
  if (buttonTextMap[buttonId] === "inputText") {
    quillCursorPosition = null;
  }
}

async function toggleRecording(buttonId) {
  try {
    // Close all other microphones first
    await Promise.all(
      Object.keys(isListening).map(async (id) => {
        if (id !== buttonId && isListening[id]) {
          await closeMicrophone(id);
          updateMicIcon(id, false);
          isListening[id] = false;
        }
      })
    );

    // Toggle the microphone for the clicked button
    if (!isListening[buttonId]) {
      shouldReconnect[buttonId] = true; // Allow reconnection for this session
      const microphone = await getMicrophone();
      microphoneInstances[buttonId] = microphone;
      await openMicrophone(buttonId);
      updateMicIcon(buttonId, true);
      isListening[buttonId] = true;

      // Maintain focus on Quill inputText if this is the inputText button
      if (
        buttonTextMap[buttonId] === "inputText" &&
        typeof quill1 !== "undefined"
      ) {
        quill1.focus();
        if (quillCursorPosition !== null) {
          quill1.setSelection(quillCursorPosition, 0);
        }
      }
    } else {
      await closeMicrophone(buttonId);
      updateMicIcon(buttonId, false);
      isListening[buttonId] = false;
    }
  } catch (error) {
    console.error(`Error in toggleRecording for ${buttonId}:`, error);
    updateMicIcon(buttonId, false);
    isListening[buttonId] = false;
    alert("Error: " + error.message);
  }
}

function updateMicIcon(buttonId, listening) {
  const micIcon = document.querySelector(`#${buttonId} .lucide-mic`);
  if (micIcon) {
    const paths = micIcon.querySelectorAll("path");
    paths.forEach((path) => {
      if (listening) {
        path.setAttribute("stroke", "#28a745"); // Green color for listening
      } else {
        path.setAttribute("stroke", "#929292"); // Default gray color
      }
    });

    if (listening) {
      micIcon.classList.add("listening-glow");
    } else {
      micIcon.classList.remove("listening-glow");
    }
  }
}

async function connectToSpeechServer(buttonId) {
  try {
    // Close existing connection if any
    if (socketInstances[buttonId]) {
      await closeWebSocketConnection(buttonId);
    }

    // Get selected language
    const language = getSelectedLanguage();

    // Create connection to your custom Speech-to-Text server
    const socket = new WebSocket(
      `${SERVER_URL}?api_key=${API_KEY}&language=${language}&model=nova-2&interim_results=false `
    );
    socketInstances[buttonId] = socket;

    return new Promise((resolve, reject) => {
      socket.onopen = () => {
        // console.log(`Connected to Speech Server for ${buttonId}`);
        reconnectAttempts[buttonId] = 0;
        resolve();
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle status messages
          if (data.status || data.error || data.warning) {
            // console.log(`Server message: ${data.message || JSON.stringify(data)}`);
            return;
          }

          // Handle transcripts
          if (
            data.channel &&
            data.channel.alternatives &&
            data.channel.alternatives.length > 0
          ) {
            const transcript = data.channel.alternatives[0].transcript;
            if (transcript && transcript.trim() !== "") {
              // console.log(`Transcript received: ${transcript}`);
              const inputTextId = buttonTextMap[buttonId];
              const inputText = document.getElementById(inputTextId);

              if (inputText) {
                if (inputText.id === "inputText") {
                  // Insert text at stored cursor position instead of always at the end
                  let insertPosition;

                  if (quillCursorPosition !== null) {
                    // Use stored cursor position
                    insertPosition = quillCursorPosition;
                  } else {
                    // Fallback: get current selection or end of document
                    const selection = quill1.getSelection();
                    insertPosition = selection
                      ? selection.index
                      : quill1.getLength() - 1;
                  }

                  // Insert the transcript at the cursor position
                  quill1.insertText(insertPosition, transcript + " ", "user");

                  // Update cursor position for next insertion
                  const newPosition = insertPosition + transcript.length + 1;
                  quillCursorPosition = newPosition;

                  // Set cursor after the inserted text
                  quill1.setSelection(newPosition, 0);

                  // Keep focus on Quill
                  quill1.focus();
                } else {
                  inputText.value += transcript + " ";
                }

                // Trigger input event for any listeners
                const inputEvent = new Event("input", { bubbles: true });
                inputText.dispatchEvent(inputEvent);
              }
            }
          }
        } catch (error) {
          console.error("Error processing message:", error, event.data);
        }
      };

      socket.onerror = (error) => {
        console.error(`WebSocket Error for ${buttonId}:`, error);
        handleWebSocketError(buttonId);
        reject(error);
      };

      socket.onclose = (event) => {
        //console.log(`WebSocket closed for ${buttonId} with code ${event.code}`);
        handleWebSocketClose(buttonId);

        // Reset cursor position when connection closes for inputText
        if (buttonTextMap[buttonId] === "inputText") {
          quillCursorPosition = null;
        }
      };
    });
  } catch (error) {
    console.error(`Speech server connection error for ${buttonId}:`, error);
    throw error;
  }
}

async function closeWebSocketConnection(buttonId) {
  const socket = socketInstances[buttonId];
  if (socket) {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    } catch (error) {
      console.error(`Error closing WebSocket for ${buttonId}:`, error);
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        delete socketInstances[buttonId];
        resolve();
      }, 1000);
    });
  }
  return Promise.resolve();
}

function handleWebSocketError(buttonId) {
  if (
    shouldReconnect[buttonId] &&
    reconnectAttempts[buttonId] < MAX_RECONNECT_ATTEMPTS
  ) {
    reconnectAttempts[buttonId] = (reconnectAttempts[buttonId] || 0) + 1;
    // console.log(`Attempting to reconnect for ${buttonId} (${reconnectAttempts[buttonId]}/${MAX_RECONNECT_ATTEMPTS})`);
    setTimeout(() => {
      connectToSpeechServer(buttonId).catch((error) => {
        console.error(`Reconnection failed for ${buttonId}:`, error);
      });
    }, 1000 * reconnectAttempts[buttonId]);
  } else if (!shouldReconnect[buttonId]) {
    // console.log(`Reconnection prevented for ${buttonId}.`);
  } else {
    console.error(`Max reconnection attempts reached for ${buttonId}`);
    alert(
      "Connection to speech recognition service failed. Please try again later."
    );
    closeMicrophone(buttonId);
  }
}

function handleWebSocketClose(buttonId) {
  if (isListening[buttonId] && shouldReconnect[buttonId]) {
    handleWebSocketError(buttonId);
  }
}

function getSelectedLanguage() {
  // Try to find language selection element - adjust selector based on your UI
  const languageSelect = document.getElementsByClassName("dk-language-text")[0];
  // console.log(languageSelect)
  if (languageSelect) {
    if (languageSelect.innerText === "Engelsk") {
      return "en-US";
    } else if (languageSelect.innerText === "Dansk") {
      return "da-DK";
    } else if (languageSelect.innerText === "Tysk") {
      return "de-DE";
    } else if (languageSelect.innerText === "Fransk") {
      return "fr-FR";
    } else if (languageSelect.innerText === "Spansk") {
      return "es";
    }
  }

  // Default to Danish if no selector found
  return "en-US";
}

async function manuallyCloseMicButton(micId) {
  const buttonId = micId;

  // console.log(`Manually closing microphone for ${buttonId}...`);
  try {
    // Prevent reconnection and close the microphone
    shouldReconnect[buttonId] = false;

    // Call the closeMicrophone function
    await closeMicrophone(buttonId);

    // Update the icon and state
    updateMicIcon(buttonId, false);
    isListening[buttonId] = false;

    // console.log(`Microphone for ${buttonId} successfully closed.`);
  } catch (error) {
    console.error(`Error manually closing microphone for ${buttonId}:`, error);
  }
}

// ! ----------------------------------- history code ----------------------------------
// =========================================================== Function to get all saved responses ===========================================================

function saveResponse(response) {
  response = response.replace(/\\/g, "");
  fetch(SB_ajax_object.ajax_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body:
      "action=korrektur_save_response&response=" +
      encodeURIComponent(response) +
      "&nonce=" +
      SB_ajax_object.nonce,
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        // // ////// console.log('Response saved successfully');
        if (
          document.getElementById("savedResponsesPopup").style.display ===
          "flex"
        ) {
          displaySavedResponses();
        }
      } else {
        console.error("Failed to save response");
      }
    })
    .catch((error) => console.error("Error:", error));
}

// Function to get saved responses via AJAX
function getSavedResponses() {
  //// console.log('inside the saved responses function');
  return fetch(
    SB_ajax_object.ajax_url +
      "?action=korrektur_get_user_responses&nonce=" +
      SB_ajax_object.nonce
  )
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        return data.data.responses;
      } else {
        console.error("Failed to get responses");
        return [];
      }
    })
    .catch((error) => {
      console.error("Error:", error);
      return [];
    });
}

function deleteResponse(responseId) {
  historyLoader(true);
  // Find the delete button associated with this response ID
  const deleteButton = document.querySelector(
    `.delete-btns[data-id="${responseId}"]`
  );
  const buttonContainer = deleteButton.closest(".button-container");

  // Add a loading class or animation
  // buttonContainer.classList.add("loading");

  fetch(SB_ajax_object.ajax_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body:
      "action=korrektur_delete_response&response_id=" +
      responseId +
      "&nonce=" +
      SB_ajax_object.nonce,
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        // Refresh the list of saved responses
        displaySavedResponses();
      } else {
        console.error("Failed to delete response");
      }
    })
    .catch((error) => {
      console.error("Error:", error);
    })
    .finally(() => {
      // Remove the loading animation after completion
      buttonContainer.classList.remove("loading");
    });
}

function convertHtmlToMarkdown(html) {
  ////// console.log("in the html to markdown function");
  ////// console.log("content of html: " + html);
  var turndownService = new TurndownService();
  return turndownService.turndown(html);
}
function formatMarkdownOutput(htmlContent) {
  return `<div class="markdown-body">${htmlContent}</div>`;
}

function onResponseGenerated(newResponse) {
  // Remove all backslashes from the newResponse
  ////// console.log("newResponse", newResponse);
  const html = marked.parse(newResponse);
  const safeHTML = DOMPurify.sanitize(html);

  let cleanedResponse = convertHtmlToMarkdown(safeHTML);
  ////// console.log("after removing backslashes", cleanedResponse);
  // Pass the cleaned response to saveResponse
  saveResponse(cleanedResponse);
}
function historyLoader(flag) {
  //// console.log("inside loader", flag);
  const loader1 = document.querySelector(".loader1");
  const popupContent = document.querySelector(".popup-content");

  if (!loader1 || !popupContent) {
    console.error("Loader or popup content not found");
    return;
  }

  //// console.log("here are loader and content", loader1, popupContent);
  if (flag) {
    loader1.style.display = "flex";
    // popupContent.style.overflowY = 'hidden';
  } else {
    loader1.style.display = "none";
    // popupContent.style.overflowY = 'scroll';
  }
}

function displaySavedResponses() {
  //// console.log("in the history")
  historyLoader(true);
  getSavedResponses()
    .then((savedResponses) => {
      console.log("Number of responses fetched:", savedResponses.length);
      const savedResponsesList = document.getElementById("savedResponsesList");
      const clearHistoryButton = document.getElementById("deleteAllHistory");
      savedResponsesList.innerHTML = "";

      if (savedResponses.length === 0) {
        savedResponsesList.innerHTML = "<p>Ingen gemte svar endnu.</p>";
        clearHistoryButton.style.display = "none";
        historyLoader(false); // Move here to ensure it runs after data is loaded
        return;
      } else {
        clearHistoryButton.style.display = "flex";
      }

      savedResponses.forEach((response, index) => {
        const responseElement = document.createElement("div");
        responseElement.className = "saved-response";

        // Decode the response text
        let decodedResponse = response.response;

        responseElement.innerHTML = `
                <div class="textarea-container">
                    <div class="response-text-area no-min-height" contenteditable="false"></div>
                </div>
                <div class="button-container">
                    <p class="copy-btn1" data-index="${index}">
                        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" class="copy-icon" xmlns="http://www.w3.org/2000/svg">
                            <g clip-path="url(#clip0_373_2280)">
                            <path d="M7.5 12.5C7.5 10.143 7.5 8.96447 8.23223 8.23223C8.96447 7.5 10.143 7.5 12.5 7.5L13.3333 7.5C15.6904 7.5 16.8689 7.5 17.6011 8.23223C18.3333 8.96447 18.3333 10.143 18.3333 12.5V13.3333C18.3333 15.6904 18.3333 16.8689 17.6011 17.6011C16.8689 18.3333 15.6904 18.3333 13.3333 18.3333H12.5C10.143 18.3333 8.96447 18.3333 8.23223 17.6011C7.5 16.8689 7.5 15.6904 7.5 13.3333L7.5 12.5Z" stroke="#929292" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M14.1665 7.49984C14.1646 5.03559 14.1273 3.75918 13.41 2.88519C13.2715 2.71641 13.1167 2.56165 12.9479 2.42314C12.026 1.6665 10.6562 1.6665 7.91663 1.6665C5.17706 1.6665 3.80727 1.6665 2.88532 2.42314C2.71654 2.56165 2.56177 2.71641 2.42326 2.88519C1.66663 3.80715 1.66663 5.17694 1.66663 7.9165C1.66663 10.6561 1.66663 12.0259 2.42326 12.9478C2.56177 13.1166 2.71653 13.2714 2.88531 13.4099C3.7593 14.1271 5.03572 14.1645 7.49996 14.1664" stroke="#929292" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </g>
                            <defs>
                            <clipPath id="clip0_373_2280">
                            <rect width="20" height="20" fill="white"/>
                            </clipPath>
                            </defs>
                        </svg>
                    </p>
                        <svg width="19" height="19" viewBox="0 0 19 16" fill="none" class="tick-btn1" xmlns="http://www.w3.org/2000/svg" style="display: none;">
                            <path d="M17.717 2.4933C18.0728 3.41378 17.5739 4.044 16.6082 4.66478C15.8291 5.16566 14.8364 5.70829 13.7846 6.63598C12.7535 7.54541 11.7472 8.64078 10.8529 9.71889C9.96223 10.7926 9.20522 11.8218 8.67035 12.5839C8.32471 13.0764 7.84234 13.8109 7.84234 13.8109C7.50218 14.3491 6.89063 14.6749 6.23489 14.6667C5.57901 14.6585 4.97657 14.3178 4.65113 13.7711C3.81924 12.3735 3.1773 11.8216 2.88226 11.6234C2.09282 11.0928 1.1665 11.0144 1.1665 9.77812C1.1665 8.79631 1.99558 8.0004 3.0183 8.0004C3.74035 8.02706 4.41149 8.31103 5.00613 8.71063C5.38625 8.96607 5.78891 9.30391 6.20774 9.74862C6.69929 9.07815 7.29164 8.30461 7.95566 7.5041C8.91998 6.34155 10.0582 5.09441 11.2789 4.0178C12.4788 2.95945 13.8662 1.96879 15.3367 1.445C16.2956 1.10347 17.3613 1.57281 17.717 2.4933Z" stroke="#929292" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    <p class="delete-btns" data-id="${response.id}">
                        
                        <svg width="19" height="19" viewBox="0 0 20 22" fill="none" class="delete-icon" xmlns="http://www.w3.org/2000/svg">
                            <path d="M17.5 4.5L16.8803 14.5251C16.7219 17.0864 16.6428 18.3671 16.0008 19.2879C15.6833 19.7431 15.2747 20.1273 14.8007 20.416C13.8421 21 12.559 21 9.99274 21C7.42312 21 6.1383 21 5.17905 20.4149C4.7048 20.1257 4.296 19.7408 3.97868 19.2848C3.33688 18.3626 3.25945 17.0801 3.10461 14.5152L2.5 4.5" stroke="#929292" stroke-width="1.5" stroke-linecap="round"></path>
                            <path d="M1 4.5H19M14.0557 4.5L13.3731 3.09173C12.9196 2.15626 12.6928 1.68852 12.3017 1.39681C12.215 1.3321 12.1231 1.27454 12.027 1.2247C11.5939 1 11.0741 1 10.0345 1C8.96883 1 8.43598 1 7.99568 1.23412C7.8981 1.28601 7.80498 1.3459 7.71729 1.41317C7.32164 1.7167 7.10063 2.20155 6.65861 3.17126L6.05292 4.5" stroke="#929292" stroke-width="1.5" stroke-linecap="round"></path>
                            <path d="M7.5 15.5L7.5 9.5" stroke="#929292" stroke-width="1.5" stroke-linecap="round"></path>
                            <path d="M12.5 15.5L12.5 9.5" stroke="#929292" stroke-width="1.5" stroke-linecap="round"></path>
                        </svg>
                        
                    </p>
                </div>
            `;

        savedResponsesList.appendChild(responseElement);

        // Get the content div and parse the markdown
        const contentDiv = responseElement.querySelector(".response-text-area");
        try {
          // If marked is available, use it to parse markdown
          if (typeof marked !== "undefined") {
            ////// console.log("in the marked content of the display history", decodedResponse);
            contentDiv.innerHTML = formatMarkdownOutput(
              marked.parse(decodedResponse)
            );
            ////// console.log("what is inide the contentdiv.innerHTML", contentDiv.innerHTML);
            ////// console.log("this is is the marked reposne of history", formatMarkdownOutput(marked.parse(decodedResponse)));
          } else {
            // Otherwise just set the content directly
            contentDiv.innerHTML = decodedResponse;
          }
        } catch (e) {
          console.error("Error parsing markdown:", e);
          contentDiv.innerHTML = decodedResponse;
        }

        // Adjust the div height similar to textarea
        adjustHistoryDivHeight(contentDiv);
      });

      // Add event listeners for buttons
      attachCopyAndDeleteEventListeners(savedResponses);

      // Move historyLoader(false) here so it only runs after everything is done
      historyLoader(false);
    })
    .catch((error) => {
      console.error("Error fetching saved responses:", error);
      historyLoader(false); // Make sure we hide the loader even if there's an error
    });
  // Remove this line as it's being moved inside the then() block
  // historyLoader(false);
}

// Helper function to adjust contenteditable div height
function adjustHistoryDivHeight(div) {
  // Reset height to auto first to get the correct scrollHeight
  div.style.height = "auto";

  // Set the height to the scrollHeight
  div.style.height = div.scrollHeight + "px";

  // Add some padding if needed
  if (div.scrollHeight > 100) {
    div.style.overflowY = "auto";
    // div.style.maxHeight = '300px';
  } else {
    div.style.overflowY = "hidden";
  }
}

// ! new version
function attachCopyAndDeleteEventListeners(savedResponses) {
  // Function to detect if the user is on a mobile device
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }

  // Function to replace colons with semicolons for mobile devices
  function processTextForMobile(text) {
    return isMobileDevice() ? text.replace(/:/g, ";") : text;
  }

  // Function to process HTML content for mobile devices
  function processHtmlForMobile(html) {
    if (!isMobileDevice()) return html;

    // Create a temporary container to parse and modify the HTML
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;

    // Process text nodes to replace colons with semicolons
    const walker = document.createTreeWalker(
      tempDiv,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while ((node = walker.nextNode())) {
      node.textContent = node.textContent.replace(/:/g, ";");
    }

    // Also process style attributes
    const allElements = tempDiv.querySelectorAll("*");
    allElements.forEach((el) => {
      if (el.hasAttribute("style")) {
        let style = el.getAttribute("style");
        // Replace colons in style values but preserve the colon after property names
        style = style.replace(
          /([a-z-]+):(.*?)(;|$)/gi,
          (match, prop, value, end) => {
            return prop + ":" + value.replace(/:/g, ";") + end;
          }
        );
        el.setAttribute("style", style);
      }
    });

    return tempDiv.innerHTML;
  }

  // Helper function to replace heading tags with strong tags
  function replaceHeadingsWithStrong(htmlContent) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlContent;

    // Find all heading tags (h1, h2, h3, h4, h5, h6)
    const headings = tempDiv.querySelectorAll("h1, h2, h3, h4, h5, h6");

    headings.forEach((heading) => {
      // Create a new strong element
      const strong = document.createElement("strong");

      // Copy all attributes from heading to strong (if any)
      Array.from(heading.attributes).forEach((attr) => {
        strong.setAttribute(attr.name, attr.value);
      });

      // Copy the inner HTML content
      strong.innerHTML = heading.innerHTML;

      // Replace the heading with the strong element
      heading.parentNode.replaceChild(strong, heading);
    });

    return tempDiv.innerHTML;
  }

  // Helper function to clean HTML content - removes background color, font size, and font family
  function cleanHTMLForCopy(htmlContent) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlContent;

    // First, replace heading tags with strong tags
    const htmlWithStrongTags = replaceHeadingsWithStrong(tempDiv.innerHTML);
    tempDiv.innerHTML = htmlWithStrongTags;

    // Remove background color, font size, and font family from all elements
    const allElements = tempDiv.querySelectorAll("*");
    allElements.forEach((el) => {
      el.style.backgroundColor = "";
      el.style.fontSize = "";
      el.style.fontFamily = "";

      // Also remove these properties from the style attribute
      if (el.hasAttribute("style")) {
        let style = el.getAttribute("style");
        style = style.replace(/background(-color)?:[^;]+;?/gi, "");
        style = style.replace(/font-size:[^;]+;?/gi, "");
        style = style.replace(/font-family:[^;]+;?/gi, "");
        style = style.replace(/color:[^;]+;?/gi, ""); // Remove font color
        if (style.trim() === "") {
          el.removeAttribute("style");
        } else {
          el.setAttribute("style", style);
        }
      }
    });

    // For mobile devices, replace colons with semicolons
    if (isMobileDevice()) {
      return processHtmlForMobile(tempDiv.innerHTML);
    }

    return tempDiv.innerHTML;
  }

  // Function to show the tick icon
  function showTickIcon(button) {
    button.style.display = "none";
    button.nextElementSibling.style.display = "flex";

    // Hide the tick icon after 2 seconds
    setTimeout(() => {
      button.style.display = "flex";
      button.nextElementSibling.style.display = "none";
    }, 2000);
  }

  // Copy buttons
  document.querySelectorAll(".copy-btn1").forEach((button) => {
    button.addEventListener("click", function () {
      const responseContainer = this.closest(".saved-response").querySelector(
        ".response-text-area"
      );

      try {
        // Set up a one-time copy event listener for this specific copy operation
        const copyListener = (e) => {
          // Get the HTML content of the selection
          const fragment = document
            .getSelection()
            .getRangeAt(0)
            .cloneContents();
          const tempDiv = document.createElement("div");
          tempDiv.appendChild(fragment);

          // Clean the HTML content (this will also replace headings with strong tags)
          const cleanedHTML = cleanHTMLForCopy(tempDiv.innerHTML);

          // Set the modified HTML as the clipboard data
          e.clipboardData.setData("text/html", cleanedHTML);

          // For plain text, handle mobile device case specifically
          let textContent = tempDiv.textContent;
          if (isMobileDevice()) {
            textContent = processTextForMobile(textContent);
          }
          e.clipboardData.setData("text/plain", textContent);

          // Prevent the default copy behavior
          e.preventDefault();

          // Remove this one-time listener
          document.removeEventListener("copy", copyListener);
        };

        // Add the listener
        document.addEventListener("copy", copyListener);

        // Use the selection method since we're dealing with already rendered content
        const range = document.createRange();
        range.selectNodeContents(responseContainer);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        // Execute copy command (this works the same as manual Ctrl+C)
        document.execCommand("copy");

        // Clear selection
        selection.removeAllRanges();

        // Show the tick icon
        showTickIcon(this);
      } catch (err) {
        console.error("Failed to copy with selection method:", err);

        // Fallback to clipboard API if selection method fails
        try {
          // Get the HTML content directly from the displayed response
          const htmlContent = responseContainer.innerHTML;

          // Clean the HTML content (this will also replace headings with strong tags)
          const cleanedHTML = cleanHTMLForCopy(htmlContent);

          // Create HTML blob with cleaned styling
          const htmlBlob = new Blob(
            [
              "<!DOCTYPE html><html><head>",
              "<style>",
              // Include only essential markdown styles, avoiding font family, size, and backgrounds
              ".markdown-body {line-height: 1.5;}",
              ".markdown-body strong {font-weight: 600;}",
              ".markdown-body p {margin-top: 0; margin-bottom: 16px;}",
              "</style>",
              "</head><body>",
              cleanedHTML,
              "</body></html>",
            ],
            { type: "text/html" }
          );

          // Plain text as fallback
          let textContent = responseContainer.textContent;
          // For mobile devices, replace colons with semicolons
          if (isMobileDevice()) {
            textContent = processTextForMobile(textContent);
          }
          const textBlob = new Blob([textContent], { type: "text/plain" });

          // Use clipboard API
          const clipboardItem = new ClipboardItem({
            "text/html": htmlBlob,
            "text/plain": textBlob,
          });

          navigator.clipboard.write([clipboardItem]).then(() => {
            // Show the tick icon
            showTickIcon(this);
          });
        } catch (fallbackErr) {
          console.error(
            "All rich copy methods failed, using plain text:",
            fallbackErr
          );

          // Final fallback to plain text
          let textContent = responseContainer.textContent;
          // For mobile devices, replace colons with semicolons
          if (isMobileDevice()) {
            textContent = processTextForMobile(textContent);
          }
          navigator.clipboard.writeText(textContent).then(() => {
            // Show the tick icon
            showTickIcon(this);
          });
        }
      }
    });
  });

  // Also add a global copy listener for manual selection copying
  document.addEventListener("copy", (e) => {
    // Only handle copy events if they weren't already handled by our button click handler
    if (e.defaultPrevented) return;

    // Check if the selection is within a response text area
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const selectionRange = selection.getRangeAt(0);
    const container = selectionRange.commonAncestorContainer;

    // Check if the selection is inside a response-text-area
    const isInResponseArea =
      (container.closest && container.closest(".response-text-area")) ||
      (container.parentNode &&
        container.parentNode.closest &&
        container.parentNode.closest(".response-text-area"));

    if (isInResponseArea) {
      // Get the HTML content of the selection
      const fragment = selectionRange.cloneContents();
      const tempDiv = document.createElement("div");
      tempDiv.appendChild(fragment);

      // Clean the HTML (this will also replace headings with strong tags)
      const cleanedHTML = cleanHTMLForCopy(tempDiv.innerHTML);

      // Set the modified HTML as the clipboard data
      e.clipboardData.setData("text/html", cleanedHTML);

      // For plain text, handle mobile device case specifically
      let textContent = tempDiv.textContent;
      if (isMobileDevice()) {
        textContent = processTextForMobile(textContent);
      }
      e.clipboardData.setData("text/plain", textContent);

      // Prevent the default copy behavior
      e.preventDefault();
    }
  });

  // Delete buttons
  document.querySelectorAll(".delete-btns").forEach((button) => {
    button.addEventListener("click", function () {
      const id = this.getAttribute("data-id");
      deleteResponse(id).then(() => {
        displaySavedResponses();
      });
    });
  });
}
// Add CSS to ensure proper textarea behavior
const style = document.createElement("style");
style.textContent = `
    .saved-response {
        margin-bottom: 10px;
        padding: 13px;
        border: 1px solid #E6E6E6;
        border-radius: 5px;
        background-color: #FFFFFF;
    }

    .textarea-container {
        width: 100%;
        margin-bottom: 10px;
    }

    .response-textarea {
        width: 100%;
        min-height: 50px;
        padding: 8px;
        border: none;
        background: transparent;
        font-family: inherit;
        font-size: inherit;
        line-height: 1.5;
        resize: none;
        overflow: hidden;
    }

    .response-textarea:focus {
        outline: none;
    }

    .button-container {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 7px;
    }
`;
document.head.appendChild(style);

// Add this to your existing resize handler
window.addEventListener("resize", () => {
  const textareas = document.querySelectorAll(".response-textarea");
  textareas.forEach((textarea) => {
    adjustHistoryTextareaHeight(textarea);
  });
});

document.addEventListener("DOMContentLoaded", function () {
  const clearHistoryButton = document.getElementById("deleteAllHistory");

  if (clearHistoryButton) {
    clearHistoryButton.addEventListener("click", function () {
      historyLoader(true);
      const savedResponsesList = document.getElementById("savedResponsesList");

      fetch(SB_ajax_object.ajax_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body:
          "action=korrektur_delete_all_user_responses&nonce=" +
          SB_ajax_object.nonce,
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            //// console.log('All responses deleted successfully');
            if (
              document.getElementById("savedResponsesPopup").style.display ===
              "flex"
            ) {
              displaySavedResponses(); // Refresh the list
            }
          } else {
            console.error("Failed to delete responses:", data.data);
          }
        })
        .catch((error) => console.error("Error:", error));
    });
  }
});

let originalZIndex;
const sidebarSelector = ".elementor-element-3189719";
const popupSelector = "#savedResponsesPopup";
const popupContentSelector = ".popup-content";
// Flag to track if popup is already being opened
let isOpeningPopup = false;
function openPopup() {
  ////// console.log("opening popup");
  if (isOpeningPopup) {
    return;
  }
  isOpeningPopup = true;
  const sidebar = document.querySelector(sidebarSelector);
  const popup = document.querySelector(popupSelector);

  if (sidebar && popup) {
    originalZIndex = window.getComputedStyle(sidebar).zIndex;
    popup.style.zIndex = "9999999";
    sidebar.style.zIndex = "0";
    popup.style.display = "flex";
    //// console.log("popup called")
    displaySavedResponses();
  }
}

function closePopup() {
  const sidebar = document.querySelector(sidebarSelector);
  const popup = document.querySelector(popupSelector);

  if (sidebar && popup) {
    // sidebar.style.zIndex = originalZIndex;
    sidebar.style.zIndex = "1";
    popup.style.zIndex = "";
    popup.style.display = "none";
  }
  isOpeningPopup = false;
}

// Handle clicks on the document to close the popup if clicked outside
function handleDocumentClick(event) {
  const popup = document.querySelector(popupSelector);
  const popupContent = document.querySelector(popupContentSelector);
  const showSavedResponsesBtn = document.getElementById(
    "showSavedResponsesBtn"
  );

  if (showSavedResponsesBtn.contains(event.target)) {
    openPopup();
    return;
  }

  if (event.target.closest(".delete-btns")) {
    return; // Don't close the popup if clicking on a delete button
  }

  if (popup.style.display === "flex" && !popupContent.contains(event.target)) {
    closePopup();
  }
}

document.addEventListener("DOMContentLoaded", function () {
  document
    .getElementById("showSavedResponsesBtn")
    .addEventListener("click", openPopup);
});

document.querySelector(".close").addEventListener("click", closePopup);
document.addEventListener("click", handleDocumentClick);

// =============================================================  download button code  ===================================================

function getCleanPlainTextFromQuillSimple(quillInstance) {
  const { text } = processQuillContentForCopy(quillInstance);
  return text;
}

function removeInlineStyles(htmlString) {
  // Create a temporary DOM element to parse the HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlString;

  // Select all elements within the parsed HTML
  const elements = tempDiv.querySelectorAll("*");

  // Remove the style attribute from each element
  elements.forEach((element) => {
    element.removeAttribute("style");
  });

  // Return the cleaned HTML as a string
  return tempDiv.innerHTML;
}

function sanitizeHtmlContentForDownload(rawHtml) {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = rawHtml;

  // 1. Convert all h1-h6 tags to <strong>
  ["h1", "h2", "h3", "h4", "h5", "h6"].forEach((hTag) => {
    const headings = tempDiv.querySelectorAll(hTag);
    headings.forEach((heading) => {
      const strongElement = document.createElement("strong");
      strongElement.innerHTML = heading.innerHTML;
      heading.parentNode.replaceChild(strongElement, heading);
    });
  });

  // 2. Remove <p><br></p> after <strong>
  const strongElements = tempDiv.querySelectorAll("strong");
  strongElements.forEach((strong) => {
    const nextSibling = strong.nextElementSibling;
    if (nextSibling && nextSibling.tagName === "P") {
      if (
        (nextSibling.childNodes.length === 1 &&
          nextSibling.firstChild &&
          nextSibling.firstChild.nodeType === Node.ELEMENT_NODE &&
          nextSibling.firstChild.tagName === "BR") ||
        nextSibling.innerHTML.trim().toLowerCase() === "<br>" ||
        nextSibling.innerHTML.trim().toLowerCase() === "<br/>" ||
        nextSibling.innerHTML.trim().toLowerCase() === "<br />"
      ) {
        nextSibling.parentNode.removeChild(nextSibling);
      }
    }
  });

  // 3. Convert bullet-point <ol> items with data-list="bullet" to <ul>
  const olElements = [...tempDiv.querySelectorAll("ol")];
  olElements.forEach((ol) => {
    const ul = document.createElement("ul");
    let liMoved = false;

    [...ol.children].forEach((li) => {
      const dataList = li.getAttribute("data-list");
      if (dataList === "bullet") {
        li.removeAttribute("data-list");
        ul.appendChild(li.cloneNode(true));
        li.remove();
        liMoved = true;
      }
    });

    if (liMoved) {
      if (ol.children.length === 0) {
        ol.replaceWith(ul);
      } else {
        ol.parentNode.insertBefore(ul, ol);
      }
    }
  });

  return tempDiv.innerHTML;
}

/* ----------------------------------------------------------
   1.  DOWNLOAD BUTTON + DROPDOWN SETUP
---------------------------------------------------------- */

const downloadBtn = document.getElementById("downloadBtn");

const dropdownHTML = `
  <div id="downloadDropdown" class="download-dropdown" style="display: none; position: absolute;">
    <div class="download-option" data-type="docx">
      <span>Word (.docx)</span>
    </div>
    <div class="download-option" data-type="pdf">
      <span>PDF (.pdf)</span>
    </div>
    <div class="download-option" data-type="txt">
      <span>Tekstfil (.txt)</span>
    </div>
  </div>
`;

// Create container for button and dropdown
const container = document.createElement("div");
container.classList.add("download-container");
container.style.position = "relative";
container.style.display = "inline-block";

// Wrap button in container
downloadBtn.parentNode.insertBefore(container, downloadBtn);
container.appendChild(downloadBtn);
container.insertAdjacentHTML("beforeend", dropdownHTML);

const dropdown = document.getElementById("downloadDropdown");

downloadBtn.addEventListener("click", () => {
  dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
});
/* ----------------------------------------------------------
   4.  DROPDOWN HANDLERS – hook up PDF/DOCX/TXT actions
---------------------------------------------------------- */
document.querySelectorAll(".download-option").forEach((option) => {
  option.addEventListener("click", async () => {
    const type = option.getAttribute("data-type");

    // Get HTML content (with formatting)
    const formattedContent = removeInlineStyles(
      removeHamDanTags(
        removeMarkTags(sanitizeHtmlContentForDownload(quill1.root.innerHTML))
      )
    );
    console.log("text going inside the downloads", formattedContent);

    // Get plain text (structure preserved)
    const plainTextContent = getCleanPlainTextFromQuillSimple(quill1);

    try {
      switch (type) {
        case "txt":
          downloadTxt(plainTextContent);
          break;
        case "docx":
          await downloadDocx();
          break;
        case "pdf":
          await downloadPdfWithPdfMake(formattedContent);
          break;
      }
    } finally {
      dropdown.style.display = "none";
    }
  });
});
document.addEventListener("click", (e) => {
  if (!downloadBtn.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.style.display = "none";
  }
});

function getDocumentTitle() {
  const html = removeInlineStyles(
    removeHamDanTags(
      removeMarkTags(sanitizeHtmlContentForDownload(quill1.root.innerHTML))
    )
  );

  // Create temporary div to parse HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  // Find the first element (not text node)
  const firstElement = tempDiv.querySelector("*");

  if (firstElement) {
    const tagName = firstElement.tagName.toLowerCase();

    // Check if first tag is strong or h1-h6
    if (
      tagName === "strong" ||
      ["h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName)
    ) {
      return firstElement.textContent.trim();
    }
  }

  // Find the first p tag with actual content (skip empty ones)
  const allPTags = tempDiv.querySelectorAll("p");
  for (let pTag of allPTags) {
    const pText = pTag.textContent.trim();

    // Skip empty p tags (or those with only br tags)
    if (pText && pText.length > 0) {
      const pWords = pText.split(/\s+/).filter((word) => word.length > 0);

      if (pWords.length <= 9) {
        return pText;
      }
      // If first non-empty p has more than 9 words, break and go to fallback
      break;
    }
  }

  // Fallback: return first 9 words from all content
  // Get text content properly by adding spaces between elements
  const allElements = tempDiv.querySelectorAll("*");
  let allText = "";

  allElements.forEach((element, index) => {
    const text = element.textContent.trim();
    if (text) {
      allText += (index > 0 ? " " : "") + text;
    }
  });

  const words = allText.split(/\s+/).filter((word) => word.length > 0);
  return words.slice(0, 9).join(" ");
}

// ! ----------------------------- download textfile -----------------------------

function downloadTxt(content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  downloadFile(url);
}
function downloadFile(url) {
  const link = document.createElement("a");
  link.href = url;
  link.download = getDocumentTitle();
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
// ! ----------------------------- download pdf -----------------------------
/* ----------------------------------------------------------
   2.  PDF SUPPORT (emoji removal for clean output)
---------------------------------------------------------- */

/* 2-A  Remove Unicode emojis from text */
function removeEmojis(text) {
  // Comprehensive emoji regex that covers most Unicode emoji ranges
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F018}-\u{1F270}]|[\u{238C}-\u{2454}]|[\u{20D0}-\u{20FF}]|[\u{FE00}-\u{FE0F}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F170}-\u{1F251}]/gu;

  return text.replace(emojiRegex, "");
}

/* 2-C  Configure fonts for pdfmake */
function configurePdfMakeFonts(fontChoice = "Roboto") {
  if (fontChoice === "Helvetica") {
    // Use Standard 14 fonts (smaller file size, English only)
    pdfMake.fonts = {
      Helvetica: {
        normal: "Helvetica",
        bold: "Helvetica-Bold",
        italics: "Helvetica-Oblique",
        bolditalics: "Helvetica-BoldOblique",
      },
      Times: {
        normal: "Times-Roman",
        bold: "Times-Bold",
        italics: "Times-Italic",
        bolditalics: "Times-BoldItalic",
      },
      Courier: {
        normal: "Courier",
        bold: "Courier-Bold",
        italics: "Courier-Oblique",
        bolditalics: "Courier-BoldOblique",
      },
    };
    console.log("✅ Configured Standard 14 fonts");
    return "Helvetica";
  } else {
    // Use default Roboto font
    console.log("✅ Using default Roboto font");
    return "Roboto";
  }
}

/* ----------------------------------------------------------
   3.  MAIN "downloadPdfWithPdfMake" ROUTINE (emoji-free)
---------------------------------------------------------- */
async function downloadPdfWithPdfMake(formattedText) {
  const rawHtml = quill1.root.innerHTML.trim();
  if (!rawHtml || rawHtml === "<p><br></p>") {
    alert("No content to export.");
    return;
  }

  try {
    console.log(
      "🔄 Starting PDF generation (removing emojis for clean output)..."
    );

    // Step 1: Configure fonts
    const font = configurePdfMakeFonts("Roboto");

    // Step 2: Clean HTML (remove custom tags AND emojis)
    const cleanedHtml = removeEmojis(formattedText);

    // Step 3: Convert to pdfmake document definition
    const docDefContent = htmlToPdfmake(cleanedHtml, {
      window,
    });

    // Step 4: Create PDF configuration
    const docDefinition = {
      pageSize: "A4",
      pageMargins: [40, 60, 40, 60],
      content: docDefContent,
      defaultStyle: {
        fontSize: 12,
        lineHeight: 1.4,
        font: font,
      },
      styles: {
        header: {
          fontSize: 18,
          bold: true,
          margin: [0, 0, 0, 10],
        },
        subheader: {
          fontSize: 16,
          bold: true,
          margin: [0, 10, 0, 5],
        },
        normal: {
          fontSize: 12,
          margin: [0, 0, 0, 5],
        },
      },
    };

    // Step 5: Generate & download PDF
    console.log(
      `📄 Generating clean PDF with ${font} font (emojis removed)...`
    );
    pdfMake.createPdf(docDefinition).download(`${getDocumentTitle()}.pdf`);
    console.log("✅ Clean PDF created successfully (no emojis)!");
  } catch (err) {
    console.error("❌ PDF generation failed:", err);
    alert("Unable to create PDF. Please check the console for details.");
  }
}

// ! ---------------------------------- download docs ----------------------------------
// -----------------------------------------------------------------------------
// Remove every op that Quill marked as { attributes: { "grammar-removed": true } }
// -----------------------------------------------------------------------------
function stripGrammarRemoved(delta) {
  // Works on either a Delta instance or a plain { ops: [...] } object
  const cleanedOps = delta.ops.filter(
    (op) => !(op.attributes && op.attributes["grammar-removed"])
  );

  // Return the same shape we got in (Delta-compatible)
  return { ops: cleanedOps };
}

// Perfect DOCX with fixed font and perfect lists
async function downloadDocx() {
  try {
    // ① Grab the editor's raw Delta
    const originalDelta = quill1.getContents();
    console.log("Before cleaning:", JSON.stringify(originalDelta, null, 2));

    // ② Drop the grammar-removed segments
    const cleanedDelta = stripGrammarRemoved(originalDelta);
    console.log(
      "Cleaned Delta for DOCX:",
      JSON.stringify(cleanedDelta, null, 2)
    );

    // ③ Build the paragraphs and doc exactly as before
    const paragraphs = deltaToDocxParagraphs(cleanedDelta);
    // Create document with list support
    const doc = new docx.Document({
      numbering: {
        config: [
          {
            reference: "bullet-numbering",
            levels: [
              {
                level: 0,
                format: docx.LevelFormat.BULLET,
                text: "•",
                alignment: docx.AlignmentType.LEFT,
                style: {
                  paragraph: {
                    indent: { left: 720, hanging: 360 },
                  },
                },
              },
              {
                level: 1,
                format: docx.LevelFormat.BULLET,
                text: "○",
                alignment: docx.AlignmentType.LEFT,
                style: {
                  paragraph: {
                    indent: { left: 1440, hanging: 360 },
                  },
                },
              },
            ],
          },
          {
            reference: "ordered-numbering",
            levels: [
              {
                level: 0,
                format: docx.LevelFormat.DECIMAL,
                text: "%1.",
                alignment: docx.AlignmentType.LEFT,
                style: {
                  paragraph: {
                    indent: { left: 720, hanging: 360 },
                  },
                },
              },
              {
                level: 1,
                format: docx.LevelFormat.LOWER_LETTER,
                text: "%2.",
                alignment: docx.AlignmentType.LEFT,
                style: {
                  paragraph: {
                    indent: { left: 1440, hanging: 360 },
                  },
                },
              },
            ],
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 720,
                right: 720,
                bottom: 720,
                left: 720,
              },
            },
          },
          children: paragraphs,
        },
      ],
    });

    // Generate blob
    const blob = await docx.Packer.toBlob(doc);

    // Download
    saveAs(blob, `${getDocumentTitle()}.docx`);

    console.log("Perfect DOCX created with fixed font and lists");
  } catch (error) {
    console.error("Error creating DOCX:", error);
  }
}

// Convert Delta to DOCX paragraphs with proper list ending spacing
function deltaToDocxParagraphs(delta) {
  const paragraphs = [];
  let currentRuns = [];
  let previousWasList = false;

  delta.ops.forEach((op, index) => {
    if (typeof op.insert === "string") {
      const text = op.insert;
      const attributes = op.attributes || {};
      const isCurrentList = !!attributes.list;

      // Handle line breaks and paragraphs
      if (text.includes("\n")) {
        const parts = text.split("\n");

        parts.forEach((part, partIndex) => {
          if (part) {
            currentRuns.push(createTextRun(part, attributes));
          }

          // Create paragraph if not the last part
          if (partIndex < parts.length - 1) {
            // Check if we need spacing after list ends
            const needsListEndSpacing = previousWasList && !isCurrentList;

            paragraphs.push(
              createParagraph(currentRuns, attributes, needsListEndSpacing)
            );
            currentRuns = [];
            previousWasList = isCurrentList;
          }
        });
      } else if (text) {
        currentRuns.push(createTextRun(text, attributes));
      }
    }
  });

  // Add final paragraph if there are remaining runs
  if (currentRuns.length > 0) {
    paragraphs.push(createParagraph(currentRuns, {}, false));
  }

  // Ensure at least one paragraph
  if (paragraphs.length === 0) {
    paragraphs.push(
      new docx.Paragraph({
        children: [createTextRun(" ", {})],
      })
    );
  }

  return paragraphs;
}

// Create text run with FIXED FONT (Calibri 11pt always)
function createTextRun(text, attributes) {
  const formatting = {
    text: text,
    font: "Calibri",
    size: 22, // Always 11pt (22 half-points)
    color: "000000", // Always black
  };

  // Only handle basic formatting
  if (attributes.bold) {
    formatting.bold = true;
  }

  if (attributes.italic) {
    formatting.italics = true;
  }

  if (attributes.underline) {
    formatting.underline = {};
  }

  if (attributes.strike) {
    formatting.strike = true;
  }

  // Superscript/Subscript
  if (attributes.script) {
    if (attributes.script === "super") {
      formatting.superScript = true;
    } else if (attributes.script === "sub") {
      formatting.subScript = true;
    }
  }

  return new docx.TextRun(formatting);
}

// Create paragraph with perfect list support and 20px spacing
function createParagraph(runs, attributes, needsListEndSpacing = false) {
  const paragraphProps = {
    children: runs.length > 0 ? runs : [createTextRun(" ", {})],
    spacing: {
      after: 300, // 20px = 15pt = 300 twips (matches your QuillJS margin)
      before: 0,
    },
  };

  // Handle lists perfectly
  if (attributes.list) {
    const indentLevel = attributes.indent || 0;

    // Remove spacing for list items
    paragraphProps.spacing = {
      after: 0,
      before: 0,
    };

    if (attributes.list === "bullet") {
      paragraphProps.numbering = {
        reference: "bullet-numbering",
        level: indentLevel,
      };
    } else if (attributes.list === "ordered") {
      paragraphProps.numbering = {
        reference: "ordered-numbering",
        level: indentLevel,
      };
    }
  } else {
    // Add extra spacing if this paragraph comes after a list
    if (needsListEndSpacing) {
      paragraphProps.spacing.before = 300; // Add 20px before this paragraph
    }

    // Handle regular indentation (not lists)
    if (attributes.indent) {
      paragraphProps.indent = {
        left: attributes.indent * 720, // Convert to twips
      };
    }

    // Text alignment for non-list items
    if (attributes.align) {
      const alignmentMap = {
        left: docx.AlignmentType.LEFT,
        center: docx.AlignmentType.CENTER,
        right: docx.AlignmentType.RIGHT,
        justify: docx.AlignmentType.JUSTIFIED,
      };
      paragraphProps.alignment = alignmentMap[attributes.align];
    }
  }

  return new docx.Paragraph(paragraphProps);
}

// ! Fixed QuillSelectionToolbar - Shows on mouse release and centers properly
class QuillSelectionToolbar {
  constructor(quillInstance) {
    this.quill = quillInstance;
    this.toolbar = null;
    this.isVisible = false;
    this.selectedText = "";
    this.selectedHtml = "";
    this.playbackSpeed = 1.0;
    this.currentAudio = null;
    this.isPlaying = false;
    this.isLoading = false;
    this.isPaused = false;
    this.selectedGender = "female"; // Always female
    this.currentLanguage = "da";
    this.audioBlob = null;
    this.speedExpanded = false;
    this.scrollHandler = null; // Track scroll handler for cleanup
    this.isSelecting = false; // Track if we're currently selecting text
    this.ttsRequestInProgress = false; // ADD: Flag to prevent multiple concurrent requests

    // console.log('QuillSelectionToolbar initialized with:', quillInstance);
    this.init();
  }

  init() {
    this.createToolbar();
    this.bindEvents();

    // FIXED: Add periodic validation to ensure toolbar doesn't get stuck
    this.validationInterval = setInterval(() => {
      if (this.isVisible && !this.validateCurrentSelection()) {
        // console.log('Periodic validation: hiding invalid toolbar');
        this.hideToolbar();
      }
    }, 1000); // Check every second

    // console.log('Selection toolbar created and events bound');
  }

  createToolbar() {
    // Remove any existing toolbar
    const existing = document.getElementById("selection-toolbar");
    if (existing) {
      existing.remove();
    }

    // Create the floating toolbar
    this.toolbar = document.createElement("div");
    this.toolbar.id = "selection-toolbar";
    this.toolbar.style.cssText = `
            position: absolute;
            background: #F5F5F5;
            border: 1px solid #B3B3B3;
            border-radius: 8px;
            padding: 6px;
            display: none;
            z-index: 9999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            gap: 6px;
            align-items: center;
            font-family: Arial, sans-serif;
            min-height: 47px;
            pointer-events: auto;
        `;

    // TTS Button (cycles through states)
    this.ttsButton = document.createElement("button");
    this.ttsButton.innerHTML = `<svg class="lucide-volume-2" width="20" height="16" viewBox="0 0 20 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M11.6666 10.3448V5.65555C11.6666 3.03455 11.6666 1.72405 10.8955 1.39791C10.1244 1.07177 9.21692 1.99844 7.40189 3.85176C6.46195 4.81153 5.92567 5.02407 4.58832 5.02407C3.41877 5.02407 2.83399 5.02407 2.41392 5.31068C1.54192 5.90562 1.67373 7.06849 1.67373 8.00016C1.67373 8.93184 1.54192 10.0947 2.41392 10.6896C2.83399 10.9763 3.41877 10.9763 4.58832 10.9763C5.92567 10.9763 6.46195 11.1888 7.40189 12.1486C9.21692 14.0019 10.1244 14.9286 10.8955 14.6024C11.6666 14.2763 11.6666 12.9658 11.6666 10.3448Z" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                        <path d="M14.1666 5.5C14.6878 6.18306 15 7.05287 15 8C15 8.94713 14.6878 9.81694 14.1666 10.5" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                        <path d="M16.6666 3.8335C17.709 4.97193 18.3333 6.42161 18.3333 8.00016C18.3333 9.57872 17.709 11.0284 16.6666 12.1668" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>`;
    this.ttsButton.title = "Læs højt";
    this.ttsButton.style.cssText = `
            border: none;
            background: #F5F5F5;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            transition: all 0.2s ease;
            min-width: 36px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        `;

    // Speed Control Container - this will hold both views
    this.speedContainer = document.createElement("div");
    this.speedContainer.style.cssText = `
            position: relative;
            display: flex;
            align-items: center;
            height: 30px;
        `;

    // Main Speed Display (shows current speed when collapsed)
    this.speedDisplay = document.createElement("button");
    this.speedDisplay.textContent = "1x";
    this.speedDisplay.style.cssText = `
            background: #EBEBEB;
            border: none;
            border-radius: 4px;
            padding: 4px 10px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            height: 30px;
            min-width: 36px;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #666666;
        `;

    // Speed Options Panel (replaces the speed display when expanded)
    this.speedPanel = document.createElement("div");
    this.speedPanel.style.cssText = `
            top: 0;
            left: 0;
            background: #F5F5F5;
            border-radius: 6px;
            display: none;
            align-items: center;
            gap: 1px;
            padding: 2px;
            height: 30px;
            width: 170px;
            box-sizing: border-box;
            z-index: 1;
        `;

    // Create speed option buttons
    const speeds = [0.5, 0.75, 1, 1.25, 1.5];
    speeds.forEach((speed, index) => {
      const speedBtn = document.createElement("button");
      speedBtn.textContent = speed === 1 ? "1x" : `${speed}x`;
      speedBtn.dataset.speed = speed;
      speedBtn.style.cssText = `
                background: ${speed === 1 ? "#EBEBEB" : "#F5F5F5"};
                color: #666666;
                border: none;
                border-radius: 3px;
                padding: 2px 4px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                width: 30px;
                height: 28px;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                flex: 1;
            `;

      speedBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectSpeed(speed);
      });

      this.speedPanel.appendChild(speedBtn);
    });

    this.speedContainer.appendChild(this.speedDisplay);
    this.speedContainer.appendChild(this.speedPanel);

    // Copy Button
    this.copyButton = document.createElement("button");
    this.copyButton.innerHTML = `
                                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"> <g clip-path="url(#clip0_373_2280)"> <path d="M7.5 12.5C7.5 10.143 7.5 8.96447 8.23223 8.23223C8.96447 7.5 10.143 7.5 12.5 7.5L13.3333 7.5C15.6904 7.5 16.8689 7.5 17.6011 8.23223C18.3333 8.96447 18.3333 10.143 18.3333 12.5V13.3333C18.3333 15.6904 18.3333 16.8689 17.6011 17.6011C16.8689 18.3333 15.6904 18.3333 13.3333 18.3333H12.5C10.143 18.3333 8.96447 18.3333 8.23223 17.6011C7.5 16.8689 7.5 15.6904 7.5 13.3333L7.5 12.5Z" stroke="#666666" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M14.1665 7.49984C14.1646 5.03559 14.1273 3.75918 13.41 2.88519C13.2715 2.71641 13.1167 2.56165 12.9479 2.42314C12.026 1.6665 10.6562 1.6665 7.91663 1.6665C5.17706 1.6665 3.80727 1.6665 2.88532 2.42314C2.71654 2.56165 2.56177 2.71641 2.42326 2.88519C1.66663 3.80715 1.66663 5.17694 1.66663 7.9165C1.66663 10.6561 1.66663 12.0259 2.42326 12.9478C2.56177 13.1166 2.71653 13.2714 2.88531 13.4099C3.7593 14.1271 5.03572 14.1645 7.49996 14.1664" stroke="#666666" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </g> <defs> <clipPath id="clip0_373_2280"> <rect width="20" height="20" fill="white"></rect> </clipPath> </defs> </svg>
                                    `;
    this.copyButton.title = "Kopier";
    this.copyButton.style.cssText = `
            border: none;
            background: #F5F5F5;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            transition: all 0.2s ease;
            min-width: 36px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        `;

    // Add all elements to toolbar
    this.toolbar.appendChild(this.ttsButton);
    this.toolbar.appendChild(this.speedContainer);
    this.toolbar.appendChild(this.copyButton);

    // Add to document
    document.body.appendChild(this.toolbar);

    this.addEventListeners();
  }

  addEventListeners() {
    // TTS Button - handles all states with debouncing
    this.ttsButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // // console.log('TTS button clicked, current state:', {
      //     isLoading: this.isLoading,
      //     isPlaying: this.isPlaying,
      //     isPaused: this.isPaused,
      //     ttsRequestInProgress: this.ttsRequestInProgress
      // });

      // FIXED: Prevent multiple clicks when request is in progress
      if (this.ttsRequestInProgress) {
        // console.log('TTS request already in progress, ignoring click');
        return;
      }

      if (this.isLoading) {
        // Cancel loading
        this.stopTTS();
      } else if (this.isPlaying) {
        // Pause audio
        this.pauseAudio();
      } else if (this.isPaused) {
        // Resume audio
        this.resumeAudio();
      } else {
        // Start TTS
        this.startTTS();
      }
    });

    // Speed Display Click - Toggle speed panel
    this.speedDisplay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleSpeedPanel();
    });

    // Copy Button
    this.copyButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // console.log('Copy button clicked');
      this.copyText();
    });

    // Hide speed panel when clicking outside
    document.addEventListener("click", (e) => {
      if (!this.speedContainer.contains(e.target)) {
        this.hideSpeedPanel();
      }
      if (!this.toolbar.contains(e.target)) {
        this.hideToolbar();
      }
    });

    // Add consistent hover effects to all buttons
    this.addHoverEffects();
  }

  addHoverEffects() {
    // Helper function to add hover effects to a button
    const addHoverEffect = (button, originalBackground = "#F5F5F5") => {
      button.addEventListener("mouseenter", () => {
        button.style.background = "#ebebeb";
        button.style.transform = "scale(1.05)";
      });

      button.addEventListener("mouseleave", () => {
        button.style.background = originalBackground;
        button.style.transform = "scale(1)";
      });
    };

    // Add hover effects to main buttons
    addHoverEffect(this.ttsButton);
    addHoverEffect(this.copyButton);
    addHoverEffect(this.speedDisplay, "#EBEBEB");

    // Add hover effects to speed panel buttons
    const speedButtons = this.speedPanel.querySelectorAll("button");
    speedButtons.forEach((speedBtn) => {
      const speed = parseFloat(speedBtn.dataset.speed);
      const originalBg = speed === this.playbackSpeed ? "#EBEBEB" : "#F5F5F5";

      speedBtn.addEventListener("mouseenter", () => {
        speedBtn.style.background = "#ebebeb";
        speedBtn.style.transform = "scale(1.05)";
      });

      speedBtn.addEventListener("mouseleave", () => {
        // Restore original background based on current selection
        const currentSpeed = parseFloat(speedBtn.dataset.speed);
        speedBtn.style.background =
          currentSpeed === this.playbackSpeed ? "#EBEBEB" : "#F5F5F5";
        speedBtn.style.transform = "scale(1)";
      });
    });
  }

  toggleSpeedPanel() {
    if (this.speedExpanded) {
      this.hideSpeedPanel();
    } else {
      this.showSpeedPanel();
    }
  }

  showSpeedPanel() {
    this.toolbar.style.gap = "0px";
    // Hide the speed display and show the panel
    this.speedDisplay.style.opacity = "0";
    this.speedDisplay.style.transform = "scale(0.8)";

    setTimeout(() => {
      this.speedDisplay.style.display = "none";
      this.speedPanel.style.display = "flex";

      // Animate panel in
      requestAnimationFrame(() => {
        this.speedPanel.style.opacity = "1";
        this.speedPanel.style.transform = "scale(1)";
      });
    }, 150);

    this.speedExpanded = true;
    this.updateSpeedButtons();

    // console.log('Speed panel expanded');
  }

  hideSpeedPanel() {
    // Hide the panel and show speed display
    this.speedPanel.style.opacity = "0";
    this.speedPanel.style.transform = "scale(0.8)";

    setTimeout(() => {
      this.speedPanel.style.display = "none";
      this.speedDisplay.style.display = "flex";

      // Animate display back in
      requestAnimationFrame(() => {
        this.speedDisplay.style.opacity = "1";
        this.speedDisplay.style.transform = "scale(1)";
      });
      this.toolbar.style.gap = "6px";
    }, 150);

    this.speedExpanded = false;
    // console.log('Speed panel collapsed');
  }

  updateSpeedButtons() {
    const buttons = this.speedPanel.querySelectorAll("button");
    buttons.forEach((btn) => {
      const speed = parseFloat(btn.dataset.speed);
      if (speed === this.playbackSpeed) {
        btn.style.background = "#EBEBEB";
        btn.style.color = "#666666";
      } else {
        btn.style.background = "#F5F5F5";
        btn.style.color = "#666666";
      }
    });
  }

  selectSpeed(speed) {
    this.playbackSpeed = speed;
    this.speedDisplay.textContent = speed === 1 ? "1x" : `${speed}x`;

    // Apply speed change immediately if audio is playing
    if (this.currentAudio && (this.isPlaying || this.isPaused)) {
      this.currentAudio.playbackRate = this.playbackSpeed;
    }

    // Update button appearance immediately
    this.updateSpeedButtons();

    // Hide the panel after a short delay to show the selection
    setTimeout(() => {
      this.hideSpeedPanel();
    }, 300);

    // console.log('Speed changed to:', speed);
  }

  bindEvents() {
    // console.log('Binding selection events...');

    // Primary method: Mouse events on the editor (only show after mouse release)
    const editor = this.quill.container.querySelector(".ql-editor");
    if (editor) {
      // Mouse down - start selection tracking
      editor.addEventListener("mousedown", () => {
        this.isSelecting = true;
        this.hideToolbar(); // Hide toolbar when starting new selection
        // console.log('Mouse down in editor - starting selection');
      });

      // Mouse up - check for selection after mouse release
      editor.addEventListener("mouseup", () => {
        if (this.isSelecting) {
          setTimeout(() => {
            this.checkAndShowToolbar();
            this.isSelecting = false;
          }, 10); // Small delay to ensure selection is complete
        }
      });

      // FIXED: Add global mouseup event to catch selections that end outside the editor
      document.addEventListener("mouseup", (e) => {
        if (this.isSelecting) {
          setTimeout(() => {
            // Check if we have a valid selection within Quill, regardless of where mouse was released
            const hasValidSelection = this.checkAndShowToolbar();
            if (hasValidSelection) {
              // console.log('Selection completed outside editor but within Quill content');
            }
            this.isSelecting = false;
          }, 10);
        }
      });

      // FIXED: Handle keyboard events for both selection and deletion
      editor.addEventListener("keyup", (e) => {
        // Check for selection keys
        if (
          e.shiftKey ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown" ||
          (e.ctrlKey && e.key === "a")
        ) {
          setTimeout(() => {
            this.checkAndShowToolbar();
          }, 10);
        }
        // Check for deletion keys (backspace, delete)
        else if (e.key === "Backspace" || e.key === "Delete") {
          setTimeout(() => {
            // Check if current selection still exists and has content
            const selection = this.quill.getSelection();
            if (!selection || selection.length === 0) {
              // console.log('Selection deleted with', e.key, '- hiding toolbar');
              this.hideToolbar();
            } else {
              // Check if selected text still exists
              const currentText = this.quill
                .getText(selection.index, selection.length)
                .trim();
              if (!currentText) {
                // console.log('Selected text is empty after deletion - hiding toolbar');
                this.hideToolbar();
              }
            }
          }, 10);
        }
        // Handle other content-changing keys
        else if (e.key.length === 1 || e.key === "Enter" || e.key === "Tab") {
          // Regular typing or content insertion - check if we need to hide toolbar
          setTimeout(() => {
            const selection = this.quill.getSelection();
            if (!selection || selection.length === 0) {
              this.hideToolbar();
            }
          }, 10);
        }
      });

      // Add keydown event for immediate deletion detection
      editor.addEventListener("keydown", (e) => {
        if ((e.key === "Backspace" || e.key === "Delete") && this.isVisible) {
          // Check if there's currently a selection that will be deleted
          const selection = this.quill.getSelection();
          if (selection && selection.length > 0) {
            // console.log('Selection will be deleted - preparing to hide toolbar');
            // Hide toolbar immediately on deletion key press
            setTimeout(() => {
              this.hideToolbar();
            }, 50); // Small delay to allow deletion to process
          }
        }
      });

      // Add text-change event listener for content modifications
      this.quill.on("text-change", (delta, oldDelta, source) => {
        if (this.isVisible) {
          setTimeout(() => {
            // Check if the selection still exists and has content
            const selection = this.quill.getSelection();
            if (!selection || selection.length === 0) {
              // console.log('Content changed and no selection - hiding toolbar');
              this.hideToolbar();
            } else {
              // Verify the selected text still exists
              const currentText = this.quill
                .getText(selection.index, selection.length)
                .trim();
              if (!currentText) {
                // console.log('Content changed and selected text is empty - hiding toolbar');
                this.hideToolbar();
              } else if (currentText !== this.selectedText) {
                // Update selected text if it changed
                this.selectedText = currentText;
              }
            }
          }, 10);
        }
      });
    }

    // Backup method: Document selection events (only for selections within Quill)
    document.addEventListener("selectionchange", () => {
      // Only process if not currently mouse selecting to avoid conflicts
      const selection = window.getSelection();
      if (selection.rangeCount > 0 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const quillEditor = this.quill.container.querySelector(".ql-editor");

        if (
          quillEditor &&
          quillEditor.contains(range.commonAncestorContainer)
        ) {
          const text = selection.toString().trim();
          if (text && !this.isSelecting) {
            // Only if we're not in the middle of a mouse selection
            this.selectedText = text;
            this.showToolbarAtDocumentSelection();
          }
        }
      } else {
        // Hide toolbar when selection is collapsed or empty
        if (this.isVisible && !this.isSelecting) {
          // console.log('Document selection cleared - hiding toolbar');
          this.hideToolbar();
        }
      }
    });

    // Add scroll event listener to update toolbar position
    this.scrollHandler = () => {
      if (this.isVisible) {
        this.updateToolbarPosition();
      }
    };

    window.addEventListener("scroll", this.scrollHandler, { passive: true });
    this.addScrollListenersToParents();
  }

  // FIXED: Centralized method to check for valid selections and show toolbar
  checkAndShowToolbar() {
    // First check Quill's internal selection
    const quillSelection = this.quill.getSelection();
    if (quillSelection && quillSelection.length > 0) {
      this.selectedText = this.quill
        .getText(quillSelection.index, quillSelection.length)
        .trim();
      if (this.selectedText) {
        // console.log('Valid Quill selection found:', this.selectedText);
        this.showToolbar(quillSelection);
        return true;
      }
    }

    // Also check document selection as backup
    const domSelection = window.getSelection();
    if (domSelection.rangeCount > 0 && !domSelection.isCollapsed) {
      const range = domSelection.getRangeAt(0);
      const quillEditor = this.quill.container.querySelector(".ql-editor");

      // FIXED: Check if selection is within Quill editor content
      if (
        quillEditor &&
        (quillEditor.contains(range.commonAncestorContainer) ||
          range.commonAncestorContainer === quillEditor ||
          this.isSelectionWithinQuill(range, quillEditor))
      ) {
        const text = domSelection.toString().trim();
        if (text) {
          this.selectedText = text;
          // console.log('Valid document selection within Quill found:', this.selectedText);
          this.showToolbarAtDocumentSelection();
          return true;
        }
      }
    }

    return false;
  }

  // FIXED: Helper method to check if selection range intersects with Quill editor
  isSelectionWithinQuill(range, quillEditor) {
    try {
      // Check if start or end of selection is within Quill
      const startContainer = range.startContainer;
      const endContainer = range.endContainer;

      const startInQuill =
        quillEditor.contains(startContainer) ||
        (startContainer.nodeType === Node.TEXT_NODE &&
          quillEditor.contains(startContainer.parentNode));
      const endInQuill =
        quillEditor.contains(endContainer) ||
        (endContainer.nodeType === Node.TEXT_NODE &&
          quillEditor.contains(endContainer.parentNode));

      return startInQuill || endInQuill;
    } catch (error) {
      // console.log('Error checking selection within Quill:', error);
      return false;
    }
  }

  addScrollListenersToParents() {
    let parent = this.quill.container.parentElement;
    while (parent && parent !== document.body) {
      if (this.isScrollable(parent)) {
        parent.addEventListener("scroll", this.scrollHandler, {
          passive: true,
        });
      }
      parent = parent.parentElement;
    }
  }

  isScrollable(element) {
    const style = window.getComputedStyle(element);
    return (
      style.overflow === "scroll" ||
      style.overflow === "auto" ||
      style.overflowY === "scroll" ||
      style.overflowY === "auto"
    );
  }

  updateToolbarPosition() {
    // Re-calculate and update toolbar position
    const selection = this.quill.getSelection();
    if (selection && selection.length > 0) {
      this.showToolbar(selection);
    } else {
      // Fallback to document selection
      const docSelection = window.getSelection();
      if (docSelection.rangeCount > 0 && !docSelection.isCollapsed) {
        this.showToolbarAtDocumentSelection();
      }
    }
  }

  // FIXED: Add utility method to validate current selection
  validateCurrentSelection() {
    const selection = this.quill.getSelection();
    if (!selection || selection.length === 0) {
      return false;
    }

    const currentText = this.quill
      .getText(selection.index, selection.length)
      .trim();
    if (!currentText) {
      return false;
    }

    // Update selectedText if it's different
    if (currentText !== this.selectedText) {
      this.selectedText = currentText;
    }

    return true;
  }

  showToolbar(range = null) {
    if (!this.selectedText || this.selectedText.trim().length === 0) {
      // console.log('No text selected, hiding toolbar');
      return;
    }

    // console.log('Showing toolbar for text:', this.selectedText);

    let x, y;

    if (range) {
      // Use Quill bounds for precise positioning
      const bounds = this.quill.getBounds(range.index, range.length);
      const editorRect = this.quill.container.getBoundingClientRect();

      // Calculate center position of selected text
      x = editorRect.left + bounds.left + bounds.width / 2 + window.scrollX;
      y = editorRect.top + bounds.top + window.scrollY;
    } else {
      // Use document selection as fallback
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        x = rect.left + rect.width / 2 + window.scrollX;
        y = rect.top + window.scrollY;
      } else {
        return;
      }
    }

    // Get toolbar dimensions for proper centering
    // Temporarily show toolbar to measure it
    this.toolbar.style.display = "flex";
    this.toolbar.style.opacity = "0";
    const toolbarRect = this.toolbar.getBoundingClientRect();
    this.toolbar.style.opacity = "1";

    // Calculate final position - center the toolbar above the selection
    const toolbarWidth = toolbarRect.width;
    const toolbarHeight = toolbarRect.height;

    // Center horizontally and position above the selection
    const finalLeft = Math.max(10, x - toolbarWidth / 2);
    const finalTop = Math.max(10, y - toolbarHeight - 5); // 10px gap above selection

    // Ensure toolbar doesn't go off screen
    const maxLeft = window.innerWidth - toolbarWidth - 10;
    const actualLeft = Math.min(finalLeft, maxLeft);

    this.toolbar.style.left = actualLeft + "px";
    this.toolbar.style.top = finalTop + "px";
    this.toolbar.style.display = "flex";
    this.isVisible = true;

    // console.log('Toolbar positioned at center of selection:', actualLeft, finalTop);

    this.updateTTSButton();
    this.hideSpeedPanel();
  }

  showToolbarAtDocumentSelection() {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();

      // Calculate center position
      const x = rect.left + rect.width / 2 + window.scrollX;
      const y = rect.top + window.scrollY;

      // Get toolbar dimensions for proper centering
      this.toolbar.style.display = "flex";
      this.toolbar.style.opacity = "0";
      const toolbarRect = this.toolbar.getBoundingClientRect();
      this.toolbar.style.opacity = "1";

      const toolbarWidth = toolbarRect.width;
      const toolbarHeight = toolbarRect.height;

      // Center horizontally and position above the selection
      const finalLeft = Math.max(10, x - toolbarWidth / 2);
      const finalTop = Math.max(10, y - toolbarHeight - 5);

      // Ensure toolbar doesn't go off screen
      const maxLeft = window.innerWidth - toolbarWidth - 10;
      const actualLeft = Math.min(finalLeft, maxLeft);

      this.toolbar.style.left = actualLeft + "px";
      this.toolbar.style.top = finalTop + "px";
      this.toolbar.style.display = "flex";
      this.isVisible = true;
      this.updateTTSButton();
      this.hideSpeedPanel();
    }
  }

  hideToolbar() {
    // console.log('Hiding toolbar');
    this.toolbar.style.display = "none";
    this.isVisible = false;
    this.hideSpeedPanel();

    // FIXED: Clear selected text when hiding toolbar
    this.selectedText = "";

    // FIXED: Stop TTS when hiding toolbar (especially important when text is deleted)
    this.stopTTS();
  }

  updateTTSButton() {
    if (this.isLoading) {
      // Show loader
      this.ttsButton.innerHTML = `
                <div class="loader4">
                    <div class="dotted-loader"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
                </div>
            `;

      this.ttsButton.title = "Loader...";
    } else if (this.isPlaying) {
      // Show pause icon
      this.ttsButton.innerHTML = `
                                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="16" viewBox="0 0 30.46 37.79">
                                        <rect fill="#E66B85" x="0" y="0" width="10.57" height="37.79" rx="5.09" ry="5.09"/>
                                        <rect fill="#E66B85" x="19.89" y="0" width="10.57" height="37.79" rx="5.09" ry="5.09"/>
                                        </svg>`;

      this.ttsButton.title = "Pause";
    } else if (this.isPaused) {
      // Show continue/play icon
      this.ttsButton.innerHTML = `
                                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="16" viewBox="0 0 345.03 382.74">
                                        <path fill="#E66B85" d="M312.29,134.11L100.12,9.28C55.83-16.78,0,15.15,0,66.53v249.67c0,51.38,55.83,83.31,100.12,57.26l212.17-124.84c43.66-25.69,43.66-88.82,0-114.51Z"></path>
                                        </svg>
                                        `;

      this.ttsButton.title = "Continue";
    } else {
      // Show speaker icon
      this.ttsButton.innerHTML = ` <svg width="20" height="16" viewBox="0 0 20 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M11.6666 10.3448V5.65555C11.6666 3.03455 11.6666 1.72405 10.8955 1.39791C10.1244 1.07177 9.21692 1.99844 7.40189 3.85176C6.46195 4.81153 5.92567 5.02407 4.58832 5.02407C3.41877 5.02407 2.83399 5.02407 2.41392 5.31068C1.54192 5.90562 1.67373 7.06849 1.67373 8.00016C1.67373 8.93184 1.54192 10.0947 2.41392 10.6896C2.83399 10.9763 3.41877 10.9763 4.58832 10.9763C5.92567 10.9763 6.46195 11.1888 7.40189 12.1486C9.21692 14.0019 10.1244 14.9286 10.8955 14.6024C11.6666 14.2763 11.6666 12.9658 11.6666 10.3448Z" stroke="#E66B85" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                            <path d="M14.1666 5.5C14.6878 6.18306 15 7.05287 15 8C15 8.94713 14.6878 9.81694 14.1666 10.5" stroke="#E66B85" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                            <path d="M16.6666 3.8335C17.709 4.97193 18.3333 6.42161 18.3333 8.00016C18.3333 9.57872 17.709 11.0284 16.6666 12.1668" stroke="#E66B85" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                        `;
      this.ttsButton.style.background = "#F5F5F5";
      this.ttsButton.title = "Læs højt";
    }
  }
  getCleanTextForTTS() {
    try {
      // First try to get HTML from DOM selection
      const domSelection = window.getSelection();

      if (domSelection.rangeCount === 0 || domSelection.isCollapsed) {
        // Fallback to plain text if no DOM selection
        console.log("No DOM selection, using plain text for TTS");
        return this.selectedText;
      }

      const quillEditor = this.quill.container.querySelector(".ql-editor");
      const range = domSelection.getRangeAt(0);

      // Check if the selection is within the Quill editor
      const isWithinEditor =
        quillEditor.contains(range.commonAncestorContainer) ||
        range.commonAncestorContainer === quillEditor;

      if (!isWithinEditor) {
        console.log("Selection not within editor, using plain text for TTS");
        return this.selectedText;
      }

      // Extract the HTML from the selection
      const selectedFragment = range.cloneContents();
      const tempDiv = document.createElement("div");
      tempDiv.appendChild(selectedFragment);
      let selectedHtml = tempDiv.innerHTML;

      if (!selectedHtml.trim()) {
        console.log("No HTML content found, using plain text for TTS");
        return this.selectedText;
      }

      console.log("Original HTML for TTS:", selectedHtml);

      // Apply removeHamdanTags if available to remove deleted words
      if (typeof removeHamDanTags === "function") {
        selectedHtml = removeHamDanTags(selectedHtml);
        console.log("HTML after removeHamdanTags:", selectedHtml);
      } else {
        console.log("removeHamdanTags function not available");
      }

      // Convert cleaned HTML to plain text for TTS
      const textDiv = document.createElement("div");
      textDiv.innerHTML = selectedHtml;

      // Get text content and clean it up
      let cleanText = textDiv.textContent || textDiv.innerText || "";

      // Remove extra whitespace and normalize
      cleanText = cleanText.replace(/\s+/g, " ").trim();

      console.log("Final clean text for TTS:", cleanText);

      return cleanText || this.selectedText; // Fallback to original text if cleaning results in empty string
    } catch (error) {
      console.error("Error getting clean text for TTS:", error);
      // Fallback to plain text on any error
      return this.selectedText;
    }
  }

  async startTTS() {
    // FIXED: Set the flag immediately to prevent multiple requests
    if (this.ttsRequestInProgress) {
      // console.log('TTS request already in progress, aborting');
      return;
    }

    if (!this.selectedText.trim()) return;

    // FIXED: Set both flags immediately
    this.ttsRequestInProgress = true;
    this.isLoading = true;
    this.isPlaying = false;
    this.isPaused = false;
    this.updateTTSButton();

    // console.log('Starting TTS for:', this.selectedText);

    try {
      // Get clean text for TTS by extracting and cleaning HTML first
      const cleanText = this.getCleanTextForTTS();

      if (!cleanText.trim()) {
        console.log("No clean text available for TTS");
        this.resetToIdle();
        return;
      }

      let lang;
      switch (currentLanguage) {
        case "da":
          lang = "Danish";
          break;
        case "en":
          lang = "English";
          break;
        case "ge":
          lang = "German";
          break;
        case "fr":
          lang = "French";
          break;
        case "es":
          lang = "Spanish";
          break;
        default:
          lang = "English";
      }

      console.log("Sending clean text to TTS:", cleanText);
      const audioBlob = await this.requestTTS(
        cleanText,
        lang,
        this.selectedGender
      );

      if (audioBlob) {
        this.audioBlob = audioBlob;
        await this.playAudio(audioBlob);
      }
    } catch (error) {
      console.error("TTS Error:", error);
      this.resetToIdle();
    } finally {
      // FIXED: Always clear the request flag when done
      this.ttsRequestInProgress = false;
    }
  }

  requestTTS(text, language, gender) {
    return new Promise((resolve, reject) => {
      jQuery.ajax({
        url: SB_ajax_object.ajax_url,
        type: "POST",
        data: {
          action: "secure_bots_tts",
          nonce: SB_ajax_object.nonce,
          text: text,
          lang: language,
          gender: gender,
        },
        xhrFields: {
          responseType: "blob",
        },
        success: function (audioData) {
          resolve(audioData);
        },
        error: function (jqXHR, textStatus, errorThrown) {
          reject(new Error(`TTS request failed: ${textStatus}`));
        },
      });
    });
  }

  async playAudio(audioData) {
    try {
      const audioUrl = URL.createObjectURL(audioData);
      this.currentAudio = new Audio(audioUrl);
      this.currentAudio.playbackRate = this.playbackSpeed;

      this.currentAudio.onended = () => {
        console.log("Audio playback ended");
        this.resetToIdle();
      };

      this.currentAudio.onerror = () => {
        console.error("Audio playback error");
        this.resetToIdle();
      };

      await this.currentAudio.play();

      this.isLoading = false;
      this.isPlaying = true;
      this.isPaused = false;
      this.updateTTSButton();

      console.log("Audio started playing");
    } catch (error) {
      console.error("Failed to play audio:", error);
      this.resetToIdle();
    }
  }

  pauseAudio() {
    if (this.currentAudio && this.isPlaying) {
      this.currentAudio.pause();
      this.isPlaying = false;
      this.isPaused = true;
      this.updateTTSButton();
      console.log("Audio paused");
    }
  }

  resumeAudio() {
    if (this.currentAudio && this.isPaused) {
      this.currentAudio
        .play()
        .then(() => {
          this.isPlaying = true;
          this.isPaused = false;
          this.currentAudio.playbackRate = this.playbackSpeed;
          this.updateTTSButton();
          console.log("Audio resumed");
        })
        .catch((error) => {
          console.error("Failed to resume audio:", error);
          this.resetToIdle();
        });
    }
  }

  stopTTS() {
    console.log("Stopping TTS");
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      if (this.currentAudio.src) {
        URL.revokeObjectURL(this.currentAudio.src);
      }
      this.currentAudio = null;
    }
    this.resetToIdle();
  }

  resetToIdle() {
    this.isLoading = false;
    this.isPlaying = false;
    this.isPaused = false;
    this.audioBlob = null;
    // FIXED: Clear the request flag when resetting
    this.ttsRequestInProgress = false;
    this.updateTTSButton();
  }

  async copyText() {
    if (!this.selectedText) return;

    console.log("Copying structured text:", this.selectedText);

    try {
      // Use the same logic as setupQuillCopyHandler from reference code
      const domSelection = window.getSelection();

      if (domSelection.rangeCount === 0 || domSelection.isCollapsed) {
        // Fallback to simple text copy if no DOM selection
        await this.simpleCopyFallback();
        return;
      }

      // Check if the selection is within our Quill editor (same as reference)
      const quillEditor = this.quill.container.querySelector(".ql-editor");
      const range = domSelection.getRangeAt(0);

      // Check if the selection is within the Quill editor
      const isWithinEditor =
        quillEditor.contains(range.commonAncestorContainer) ||
        range.commonAncestorContainer === quillEditor;

      if (!isWithinEditor) {
        await this.simpleCopyFallback();
        return;
      }

      // *** EXTRACT THE ACTUAL SELECTED HTML STRUCTURE *** (same as reference)
      // Clone the selected content as a document fragment
      const selectedFragment = range.cloneContents();

      // Create a temporary div to hold the fragment and get its HTML
      const tempDiv = document.createElement("div");
      tempDiv.appendChild(selectedFragment);

      let selectedHtml = tempDiv.innerHTML;

      // Apply removeMarkTags if available (same as reference)
      try {
        if (typeof removeMarkTags === "function") {
          selectedHtml = removeMarkTags(selectedHtml);
        }
      } catch (error) {
        console.log("removeMarkTags not available");
      }

      // If we got empty or minimal content, try a different approach (same as reference)
      if (!selectedHtml.trim()) {
        // Alternative: Create a new range and try again
        const newRange = document.createRange();
        newRange.selectNodeContents(range.commonAncestorContainer);
        const altFragment = newRange.cloneContents();
        const altDiv = document.createElement("div");
        altDiv.appendChild(altFragment);
        selectedHtml = altDiv.innerHTML;
      }

      // Get the plain text version for comparison
      const selectedText = domSelection.toString();

      if (!selectedText || selectedText.trim() === "") {
        await this.simpleCopyFallback();
        return;
      }

      // *** APPLY UPDATED UNIVERSAL HTML PROCESSING *** (same as reference)
      if (typeof processHtmlForCopy === "function") {
        selectedHtml = processHtmlForCopy(selectedHtml, "selection");
      }

      // Process the selected HTML content (same logic as reference)
      const processDiv = document.createElement("div");
      processDiv.innerHTML = selectedHtml;

      // Apply transformations while preserving structure (same as reference)

      // 1. Convert headings to strong tags (same as reference)
      const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"];
      let totalHeadingsConverted = 0;

      headingTags.forEach((hTag) => {
        const headings = processDiv.querySelectorAll(hTag);

        headings.forEach((heading, index) => {
          const strongElement = document.createElement("strong");
          strongElement.innerHTML = heading.innerHTML;
          heading.parentNode.replaceChild(strongElement, heading);
          totalHeadingsConverted++;
        });
      });

      // 2. Remove empty paragraphs after strong tags (same as reference)
      const strongElements = processDiv.querySelectorAll("strong");
      let emptyParagraphsRemoved = 0;

      strongElements.forEach((strong, index) => {
        const nextSibling = strong.nextElementSibling;

        if (nextSibling && nextSibling.tagName === "P") {
          const isEmpty =
            (nextSibling.childNodes.length === 1 &&
              nextSibling.firstChild &&
              nextSibling.firstChild.nodeType === Node.ELEMENT_NODE &&
              nextSibling.firstChild.tagName === "BR") ||
            nextSibling.innerHTML.trim() === "<br>" ||
            nextSibling.innerHTML.trim() === "<br/>" ||
            nextSibling.innerHTML.trim() === "<br />";

          if (isEmpty) {
            nextSibling.parentNode.removeChild(nextSibling);
            emptyParagraphsRemoved++;
          }
        }
      });

      // 3. Clean up styles (same as reference)
      const allElements = processDiv.querySelectorAll("*");

      let styleModifications = 0;
      allElements.forEach((el, index) => {
        const beforeStyle = el.getAttribute("style");

        // Remove unwanted styles but preserve table structure
        el.style.backgroundColor = "";
        el.style.fontSize = "";
        el.style.fontFamily = "";
        el.style.color = "";

        if (el.hasAttribute("style")) {
          let style = el.getAttribute("style");
          const originalStyle = style;

          style = style.replace(/background(-color)?:[^;]+;?/gi, "");
          style = style.replace(/font-size:[^;]+;?/gi, "");
          style = style.replace(/font-family:[^;]+;?/gi, "");
          style = style.replace(/color:[^;]+;?/gi, "");

          if (style.trim() === "") {
            el.removeAttribute("style");
          } else {
            el.setAttribute("style", style);
          }

          if (originalStyle !== (el.getAttribute("style") || "")) {
            styleModifications++;
          }
        }
      });

      // Get the processed HTML
      let htmlContent = processDiv.innerHTML;

      // *** UPDATED *** Generate text with universal spacing (same as reference)
      let textContent = selectedText; // Default fallback

      if (typeof quillHtmlToPlainTextWithParagraphs === "function") {
        textContent = quillHtmlToPlainTextWithParagraphs(htmlContent);
      }

      // Apply mobile processing if needed (same as reference)
      if (typeof isMobileDevice === "function" && isMobileDevice()) {
        if (typeof processHtmlForMobile === "function") {
          htmlContent = processHtmlForMobile(htmlContent);
        }
        if (typeof processTextForMobile === "function") {
          textContent = processTextForMobile(textContent);
        }
      }

      // Use modern clipboard API with both HTML and plain text (same as reference)
      if (navigator.clipboard && navigator.clipboard.write) {
        try {
          const clipboardItems = [
            new ClipboardItem({
              "text/html": new Blob([htmlContent], { type: "text/html" }),
              "text/plain": new Blob([textContent], { type: "text/plain" }),
            }),
          ];

          await navigator.clipboard.write(clipboardItems);
          this.showCopySuccess();
        } catch (clipboardError) {
          throw clipboardError; // Re-throw to fall back to alternative method
        }
      } else {
        throw new Error("Modern clipboard API not supported");
      }
    } catch (error) {
      console.log("Falling back to alternative copy methods", error);
      // Use the same fallback method as reference code
      try {
        // Fallback method for browsers without clipboard API support (same as reference)
        const tempElement = document.createElement("div");
        tempElement.setAttribute("contenteditable", "true");
        tempElement.innerHTML = htmlContent;
        tempElement.style.position = "absolute";
        tempElement.style.left = "-9999px";
        tempElement.style.top = "-9999px";
        document.body.appendChild(tempElement);

        // Select the content
        const range = document.createRange();
        range.selectNodeContents(tempElement);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        // Execute copy command
        const copySuccess = document.execCommand("copy");

        // Clean up
        selection.removeAllRanges();
        document.body.removeChild(tempElement);

        if (copySuccess) {
          this.showCopySuccess();
        } else {
          throw new Error("execCommand copy failed");
        }
      } catch (fallbackErr) {
        try {
          // Last resort - plain text only (same as reference)
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(this.selectedText);
            this.showCopySuccess();
          } else {
            throw new Error("All clipboard methods failed");
          }
        } catch (textOnlyError) {
          console.error("All copy methods failed:", textOnlyError);
        }
      }
    }
  }

  async simpleCopyFallback() {
    // Simple fallback when no DOM selection is available
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(this.selectedText);
        this.showCopySuccess();
      } else {
        this.fallbackCopy("", this.selectedText);
      }
    } catch (error) {
      this.fallbackCopy("", this.selectedText);
    }
  }

  fallbackCopy(htmlContent = "", textContent = "") {
    try {
      // Method 1: Try with HTML content if available
      if (htmlContent) {
        const tempElement = document.createElement("div");
        tempElement.setAttribute("contenteditable", "true");
        tempElement.innerHTML = htmlContent;
        tempElement.style.position = "absolute";
        tempElement.style.left = "-9999px";
        tempElement.style.top = "-9999px";
        document.body.appendChild(tempElement);

        // Select the content
        const range = document.createRange();
        range.selectNodeContents(tempElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        // Execute copy command
        const copySuccess = document.execCommand("copy");

        // Clean up
        selection.removeAllRanges();
        document.body.removeChild(tempElement);

        if (copySuccess) {
          this.showCopySuccess();
          return;
        }
      }

      // Method 2: Fallback to plain text
      const textArea = document.createElement("textarea");
      textArea.value = textContent || this.selectedText;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "-9999px";
      document.body.appendChild(textArea);
      textArea.select();

      const copySuccess = document.execCommand("copy");
      document.body.removeChild(textArea);

      if (copySuccess) {
        this.showCopySuccess();
      } else {
        throw new Error("execCommand copy failed");
      }
    } catch (err) {
      console.error("All copy methods failed:", err);
      // Last resort: try basic clipboard writeText
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(textContent || this.selectedText)
          .then(() => this.showCopySuccess())
          .catch(() => console.error("Final fallback also failed"));
      }
    }
  }

  showCopySuccess() {
    const originalContent = this.copyButton.innerHTML;
    const originalColor = this.copyButton.style.background;

    this.copyButton.innerHTML = `<svg width="19" height="16" viewBox="0 0 19 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.717 2.4933C18.0728 3.41378 17.5739 4.044 16.6082 4.66478C15.8291 5.16566 14.8364 5.70829 13.7846 6.63598C12.7535 7.54541 11.7472 8.64078 10.8529 9.71889C9.96223 10.7926 9.20522 11.8218 8.67035 12.5839C8.32471 13.0764 7.84234 13.8109 7.84234 13.8109C7.50218 14.3491 6.89063 14.6749 6.23489 14.6667C5.57901 14.6585 4.97657 14.3178 4.65113 13.7711C3.81924 12.3735 3.1773 11.8216 2.88226 11.6234C2.09282 11.0928 1.1665 11.0144 1.1665 9.77812C1.1665 8.79631 1.99558 8.0004 3.0183 8.0004C3.74035 8.02706 4.41149 8.31103 5.00613 8.71063C5.38625 8.96607 5.78891 9.30391 6.20774 9.74862C6.69929 9.07815 7.29164 8.30461 7.95566 7.5041C8.91998 6.34155 10.0582 5.09441 11.2789 4.0178C12.4788 2.95945 13.8662 1.96879 15.3367 1.445C16.2956 1.10347 17.3613 1.57281 17.717 2.4933Z" stroke="#666666" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>`;
    this.copyButton.style.background = "#F5F5F5";

    setTimeout(() => {
      this.copyButton.innerHTML = originalContent;
      this.copyButton.style.background = originalColor;
    }, 1500);
  }

  // Cleanup method
  destroy() {
    // FIXED: Clear validation interval
    if (this.validationInterval) {
      clearInterval(this.validationInterval);
    }

    // Remove scroll listeners
    if (this.scrollHandler) {
      window.removeEventListener("scroll", this.scrollHandler);

      // Remove from parent containers
      let parent = this.quill.container.parentElement;
      while (parent && parent !== document.body) {
        if (this.isScrollable(parent)) {
          parent.removeEventListener("scroll", this.scrollHandler);
        }
        parent = parent.parentElement;
      }
    }

    // Stop any playing audio
    this.stopTTS();

    // Remove toolbar from DOM
    if (this.toolbar && this.toolbar.parentNode) {
      this.toolbar.parentNode.removeChild(this.toolbar);
    }
  }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  console.log("DOM loaded, initializing selection toolbar...");

  // Wait a bit for Quill to be ready
  setTimeout(() => {
    if (typeof quill1 !== "undefined") {
      console.log("Quill instance found:", quill1);
      window.selectionToolbar = new QuillSelectionToolbar(quill1);
    } else {
      console.error("Quill instance (quill1) not found!");

      // Try to find Quill instance in different ways
      const quillContainers = document.querySelectorAll(".ql-container");
      console.log("Found Quill containers:", quillContainers.length);

      if (window.Quill) {
        console.log("Quill library available");
      }
    }
  }, 1000);
});

// Debug function to test manually
window.testSelectionToolbar = function () {
  console.log("Testing selection toolbar...");
  if (window.selectionToolbar) {
    console.log("Selection toolbar exists");
    window.selectionToolbar.selectedText = "Test text";
    window.selectionToolbar.showToolbarAtDocumentSelection();
  } else {
    console.log("Selection toolbar not found");
  }
};

// Cleanup on page unload
window.addEventListener("beforeunload", function () {
  if (window.selectionToolbar) {
    window.selectionToolbar.destroy();
  }
});

console.log("Selection toolbar script loaded");

// Toggle sidebar collapse manually
document.addEventListener("DOMContentLoaded", () => {
  const sidebarToggleBtn = document.getElementById("sidebarCollapseBtn");
  const sidebar = document.querySelector(".correction-sidebar");
  const headerSection = document.querySelector(".header-section");

  if (sidebarToggleBtn && sidebar && headerSection) {
    sidebarToggleBtn.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");

      // Flip the icon (optional)
      const icon = sidebarToggleBtn.querySelector("polyline");
      if (sidebar.classList.contains("collapsed")) {
        if (icon) icon.setAttribute("points", "9 18 15 12 9 6"); // chevron-right
        headerSection.style.flexWrap = "wrap";
      } else {
        if (icon) icon.setAttribute("points", "15 18 9 12 15 6"); // chevron-left
        headerSection.style.flexWrap = "nowrap";
      }
    });
  }
});

document.querySelectorAll('.sidebar-icon-btn').forEach((iconBtn) => {
  iconBtn.addEventListener('click', function() {
    const sidebar = document.querySelector('.correction-sidebar');
    const sidebarIcons = document.querySelector('.sidebar-collapsed-icons');
    const headerSection = document.querySelector('.header-section');
    // Expand the sidebar if collapsed
    if (sidebar && sidebar.classList.contains('collapsed')) {
      toggleState = true;
      if (typeof setCookie === "function") setCookie("korrektur-toggle", toggleState, 30);
      if (typeof actionOnToggle === "function") actionOnToggle(toggleState);
      const correctionSwitch = document.getElementById("correction-toggle");
      if (correctionSwitch) correctionSwitch.checked = true;
      // Fix header section wrapping
      if (headerSection) headerSection.style.flexWrap = "nowrap";
    }
    // Always hide the icons when expanded
    if (sidebarIcons) sidebarIcons.style.display = "none";

    // Find the corresponding dropdown option
    const optionValue = this.getAttribute('data-option');
    const dropdownOption = document.querySelector('.hk-dropdown-option[data-option="' + optionValue + '"]');
    if (dropdownOption) {
      updateSelectedOption(dropdownOption);
    }
  });
});