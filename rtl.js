/* Claude Desktop RTL patch — injected renderer script (macOS).
 *
 * Runs inside every web contents (the claude.ai chat view and the local
 * wrapper window). It auto-detects right-to-left text (Hebrew, Arabic, and
 * related scripts) in chat messages and the composer, then aligns direction
 * in real time — including during streaming. It is a no-op on pages with no
 * RTL text. Code blocks and math are always kept left-to-right.
 *
 * Injected via webContents.executeJavaScript(), so it runs in the page's
 * main world but is not subject to the page's Content-Security-Policy.
 */
(function () {
  if (window.__claudeRtlPatch) return;
  window.__claudeRtlPatch = true;

  // Strong RTL characters: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan,
  // Arabic presentation forms, plus astral Adlam / Mende Kikakui.
  var RTL_STRONG =
    /[֐-׿؀-ۿ܀-ݏݐ-ݿހ-޿߀-߿ࠀ-࠿ࢠ-ࣿיִ-ﭏﭐ-﷿ﹰ-﻿]/;
  var RTL_ASTRAL = /\uD803[\uDD00-\uDD3F]|\uD83A[\uDD00-\uDD5F]/; // Adlam, Mende
  // Strong LTR: Latin, Greek, Cyrillic, Armenian and common CJK.
  var LTR_STRONG = /[A-Za-zÀ-ʯͰ-ϿЀ-ӿ԰-֏぀-ヿ一-鿿]/;
  var ANY_RTL = new RegExp(RTL_STRONG.source + "|" + RTL_ASTRAL.source);

  // Leading neutral tokens we skip before deciding direction:
  // urls, emails, @handles, #tags, file paths, numbers, bullets, punctuation.
  var LEADING_NEUTRAL =
    /^(?:\s|[0-9]+[.)]?|[-*•▪◦+]|https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|[\/~][\w./~-]+|[\w-]+\.[A-Za-z]{1,8}\b|[\p{P}\p{S}])+/u;

  // Decide direction of a string by first strong character, with neutral-strip.
  function dirOf(text) {
    if (!text) return null;
    if (!ANY_RTL.test(text)) return null; // fast path: no RTL anywhere -> leave LTR
    var d = firstStrong(text);
    if (d) return d;
    // First-strong was hidden behind a leading url/path/number — strip and retry.
    var stripped = text.replace(LEADING_NEUTRAL, "");
    d = firstStrong(stripped);
    if (d) return d;
    // RTL chars exist but only after LTR content (e.g. "see שלום"): treat as RTL
    // only if the RTL portion dominates the line.
    return rtlShare(text) >= 0.4 ? "rtl" : null;
  }

  function firstStrong(text) {
    for (var i = 0; i < text.length; i++) {
      var two = text.substr(i, 2);
      if (RTL_ASTRAL.test(two)) return "rtl";
      var ch = text[i];
      if (RTL_STRONG.test(ch)) return "rtl";
      if (LTR_STRONG.test(ch)) return "ltr";
    }
    return null;
  }

  function rtlShare(text) {
    var rtl = 0, ltr = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (RTL_STRONG.test(ch)) rtl++;
      else if (LTR_STRONG.test(ch)) ltr++;
    }
    var total = rtl + ltr;
    return total ? rtl / total : 0;
  }

  // Text of an element excluding code / math descendants (those stay LTR and
  // shouldn't influence the paragraph's direction).
  function textIgnoringCode(el) {
    var clone = el.cloneNode(true);
    var drop = clone.querySelectorAll("code, pre, kbd, samp, .katex, .katex-display");
    for (var i = 0; i < drop.length; i++) drop[i].remove();
    return clone.textContent || "";
  }

  // Does this block contain multiple lines of differing direction?
  function isMixedMultiline(el) {
    if (!el.querySelector("br")) {
      var t = el.textContent || "";
      if (t.indexOf("\n") === -1) return false;
    }
    var lines = (el.textContent || "").split(/\n| /).filter(function (s) {
      return ANY_RTL.test(s) || /[A-Za-z]/.test(s);
    });
    var dirs = {};
    for (var i = 0; i < lines.length; i++) {
      var d = dirOf(lines[i]);
      if (d) dirs[d] = 1;
    }
    return dirs.rtl && dirs.ltr;
  }

  var BLOCK_SELECTOR =
    "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption, summary, .prose div";

  function tag(el) {
    // Never retag code/math containers.
    if (el.closest("pre, code, .katex, .katex-display")) return;
    var current = el.getAttribute("data-claude-rtl");
    var value;
    if (isMixedMultiline(el)) {
      value = "auto";
    } else {
      var d = dirOf(textIgnoringCode(el));
      if (!d) {
        if (current) el.removeAttribute("data-claude-rtl");
        return;
      }
      value = d;
    }
    if (current !== value) el.setAttribute("data-claude-rtl", value);
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(BLOCK_SELECTOR)) tag(root);
    var nodes = root.querySelectorAll ? root.querySelectorAll(BLOCK_SELECTOR) : [];
    for (var i = 0; i < nodes.length; i++) tag(nodes[i]);
  }

  // ---- Composer (textarea / contenteditable) -----------------------------
  function applyComposer(el) {
    var text =
      el.value !== undefined ? el.value : el.textContent || "";
    var d = dirOf(text) || "ltr";
    el.setAttribute("data-claude-rtl", d);
    el.style.direction = d;
    el.style.textAlign = d === "rtl" ? "right" : "left";
  }

  function hookComposers() {
    var fields = document.querySelectorAll(
      'textarea, [contenteditable="true"], [contenteditable=""]'
    );
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (el.__rtlHooked) continue;
      el.__rtlHooked = true;
      var handler = applyComposer.bind(null, el);
      el.addEventListener("input", handler);
      el.addEventListener("paste", function (e) {
        var t = e.target;
        setTimeout(function () { applyComposer(t); }, 0);
      });
      applyComposer(el);
    }
  }

  // ---- Streaming / SPA updates -------------------------------------------
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      scan(document.body);
      hookComposers();
    });
  }

  function start() {
    if (!document.body) {
      return void setTimeout(start, 50);
    }
    scan(document.body);
    hookComposers();
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "characterData") {
          var p = m.target.parentElement;
          if (p) {
            var b = p.closest(BLOCK_SELECTOR);
            if (b) tag(b);
          }
        } else {
          schedule();
          return;
        }
      }
    });
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  start();
})();
