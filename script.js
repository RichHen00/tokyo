  (() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    // Four treatments. Three are ported from anim.html, whose durations are
    // absolute and tuned to much shorter strings — "Hey" is 3 characters, a
    // labs row 9 to 20 — so each is expressed here as a rate and the
    // duration is derived from the block's own length.
    //
    //   caret    anim.html "Hey"    360ms / 3ch  = 120ms/ch
    //   fast     anim.html bio    1850ms / 328ch = 5.6ms/ch — but this page
    //            carries 850 characters of body copy against anim.html's
    //            328, so the same rate takes three times as long here.
    //            Cut to 2.5ms/ch.
    //   decode   3.html's whole-line scramble at 16.7ms/ch, one character
    //            per 60Hz frame, with the unresolved remainder dimmed as a
    //            run of same-class glyphs rather than a single tip.
    //
    // Every treatment is then clamped to MAX_MS, so no block can take
    // 500ms or more to resolve however much text it holds. That ceiling is
    // what forces the caret rate down: at anim.html's 120ms/ch the title
    // alone would run for nearly five seconds.
    const MAX_MS = 480;
    const RATE_CARET = 12;      // ~1.4 chars per 60Hz frame
    const RATE_FAST = 2.5;
    const RATE_DECODE = 16.7;   // 3.html's rate, verbatim
    const GAP = 120;            // pause between treatments

    const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+-";
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Case-matched pools, from 3.html: a lowercase letter never scrambles
    // into an uppercase one, which keeps the line's rhythm and widths
    // stable. Spaces and punctuation have no pool and simply stay put.
    const POOLS = {
      upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      lower: "abcdefghijklmnopqrstuvwxyz",
      digit: "0123456789",
    };
    const poolFor = (c) =>
      c >= "a" && c <= "z" ? POOLS.lower :
      c >= "A" && c <= "Z" ? POOLS.upper :
      c >= "0" && c <= "9" ? POOLS.digit : null;

    // Everything from the lock-in point onward becomes a same-class glyph.
    const scramble = (text, from) => {
      let out = "";
      for (let i = from; i < text.length; i++) {
        const pool = poolFor(text[i]);
        out += pool ? pool[Math.floor(Math.random() * pool.length)] : text[i];
      }
      return out;
    };

    // Recurse so nested markup — the Archive trigger — survives the animation.
    // `collect` goes false once the recursion enters the trigger: the descent
    // still happens, so nested markup is still exercised, but the trigger's own
    // label is left alone. It sits above the eyebrow and has to be readable and
    // clickable on first paint, so its text is never taken.
    const textNodes = (root, out = [], collect = true) => {
      for (const node of root.childNodes) {
        if (node.nodeType === 3) {
          if (collect) out.push(node);
        } else if (node.nodeType === 1) {
          textNodes(node, out, collect && !node.classList.contains("archive-btn"));
        }
      }
      return out;
    };

    // Each block keeps one visible prefix text node per text node, plus a
    // single span holding the unresolved remainder. What goes in that span
    // differs by treatment: one dimmed tip glyph, or the whole scrambled
    // tail. Writing to those existing nodes each frame avoids re-parsing
    // innerHTML 60 times a second.
    const prepare = (el, treatment) => {
      const original = el.innerHTML;
      el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim());
      const mode = treatment === "decode" ? "decode" : "tip";

      const parts = textNodes(el).map((node) => {
        const text = node.nodeValue;
        // Grab the parent first: replaceChild detaches the old node, so
        // node.parentNode is null on the next line.
        const parent = node.parentNode;
        const prefix = document.createTextNode("");
        const rest = document.createElement("span");
        rest.className = mode === "decode" ? "decode" : "temp";
        parent.replaceChild(prefix, node);
        parent.insertBefore(rest, prefix.nextSibling);
        return { prefix, rest, text, chars: text.length, mode };
      });

      return { el, original, parts, mode, chars: el.getAttribute("aria-label").length };
    };

    const type = (block, duration) =>
      new Promise((resolve) => {
        const start = performance.now();

        (function frame(now) {
          const progress = Math.min((now - start) / duration, 1);

          for (const part of block.parts) {
            const count = Math.floor(progress * part.chars);
            part.prefix.nodeValue = part.text.slice(0, count);

            if (part.mode === "decode") {
              // 3.html: the whole remainder is same-class noise, so the
              // line is dimmed noise that resolves left to right.
              part.rest.textContent = scramble(part.text, count);
            } else {
              // anim.html: a single dimmed glyph sits at the tip. A space
              // keeps its own glyph so word gaps do not flicker.
              const next = part.text[count];
              part.rest.textContent =
                progress >= 1 || next === undefined ? ""
                : next === " " ? " "
                : glyphs[Math.floor(Math.random() * glyphs.length)];
            }
          }

          if (progress < 1) {
            requestAnimationFrame(frame);
          } else {
            // Restoring the captured markup drops the tip span and hands
            // the real text back to the accessibility tree.
            block.el.innerHTML = block.original;
            block.el.removeAttribute("aria-label");
            resolve();
          }
        })(performance.now());
      });

    // The requested mapping.
    const plan = [];
    const add = (el, treatment) => { if (el) plan.push({ el, treatment }); };

    // .archive-row is the first block in .text and holds the trigger, so it
    // animates first. Its collected parts are empty by design — see textNodes()
    // — which makes it the block that carries nested markup through prepare()
    // and the innerHTML restore, keeping both paths exercised on every load.
    add(document.querySelector(".archive-row"), "caret");
    add(document.querySelector(".eyebrow"), "decode");       // 3.html's scramble
    add(document.querySelector(".title"), "caret");          // 1. Hey
    add(document.querySelector(".intro"), "fast");           // 2. bio
    document.querySelectorAll(".copy p").forEach((p) => add(p, "fast"));
    document.querySelectorAll(".source").forEach((p) => add(p, "caret"));

    // Length is read before prepare() empties the element. One ceiling
    // applies to every treatment, so each block resolves in under 500ms
    // however much text it holds.
    const blocks = plan.map(({ el, treatment }) => {
      const chars = el.textContent.replace(/\s+/g, " ").trim().length;
      const duration = Math.min(
        treatment === "caret" ? chars * RATE_CARET :
        treatment === "fast" ? chars * RATE_FAST :
        chars * RATE_DECODE,
        MAX_MS
      );
      return { ...prepare(el, treatment), treatment, duration };
    });

    const h1 = document.querySelector(".title");

    async function run() {
      for (const block of blocks) {
        await type(block, block.duration);
        if (block.el === h1) h1.classList.add("done");
        await wait(GAP);
      }
    }

    // fonts.ready, not a fixed sleep: never type in the fallback face.
    document.fonts.ready.then(run);
  })();
