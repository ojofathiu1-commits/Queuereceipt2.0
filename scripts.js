document.addEventListener('DOMContentLoaded', function () {
  /* ------------------------------------------------------------------ *
   * Site header height: every section[id]'s scroll-margin-top reads this
   * custom property rather than a hardcoded guess, so an anchor click never
   * lands a section partly under the sticky header. Re-measured on load,
   * resize, and webfont swap -- the same class of drift that broke the
   * legal-page docking bar's spacer earlier is possible here too.
   * ------------------------------------------------------------------ */

  const siteHeader = document.querySelector('.header-nav');
  const applyHeaderHeight = function () {
    if (!siteHeader) return;
    const h = Math.round(siteHeader.getBoundingClientRect().height);
    if (h) document.documentElement.style.setProperty('--site-header-h', h + 'px');
  };

  applyHeaderHeight();
  window.addEventListener('load', applyHeaderHeight);
  window.addEventListener('resize', applyHeaderHeight);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(applyHeaderHeight);
  }

  /* ------------------------------------------------------------------ *
   * Anchor scrolling.
   *
   * This replaces `scroll-behavior: smooth`, whose curve the CSS spec gives
   * no way to tune and which differs per engine. Sampling pageYOffset every
   * frame during a real click showed Chrome's peaks at ~4.2x its own mean
   * speed -- 444px in one frame on the 9368px hero-to-final-CTA hop, i.e.
   * half a 390px-wide phone's viewport smearing past between two frames.
   * What is below arrives in the same wall-clock time with that peak halved.
   *
   * Trap worth knowing: window.scrollTo(x, y) and the one-argument form obey
   * CSS scroll-behavior, so a per-frame step written that way gets animated
   * *again* by the engine and the two fight. Every write here passes
   * behavior:'instant' explicitly -- the same fix the legal deep-link code
   * further down already carries.
   * ------------------------------------------------------------------ */

  /* Hard ceiling on a flight, so anything that has to outlast one (the two
     scrollspy locks below) can be sized off a real number instead of a guess. */
  const SCROLL_MAX_MS = 1500;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* cubic-bezier(0.28, 0.06, 0.35, 1), chosen by measuring candidates rather
     than reading control points. Symmetric in/out curves (sine, quad) hold
     the peak down but stop dead on arrival; the ease-out families every
     scroll library reaches for (quint, expo) peak *higher* than native over
     these distances -- outQuint measured 383px/frame against native's 323.
     This one keeps quad's peak (2.0x mean) with a ~50% longer settle, so the
     page arrives instead of halting. */
  const easeScroll = (function (x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    return function (x) {
      let t = x, e, d;
      // Monotonic and well-conditioned for these control points, so Newton
      // alone converges; no bisection fallback needed.
      for (let i = 0; i < 6; i++) {
        e = ((ax * t + bx) * t + cx) * t - x;
        if (Math.abs(e) < 1e-4) break;
        d = (3 * ax * t + 2 * bx) * t + cx;
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      return ((ay * t + by) * t + cy) * t;
    };
  })(0.28, 0.06, 0.35, 1);

  /* Duration follows sqrt(distance), not a constant and not a proportion: a
     fixed duration makes a 300px hop feel syrupy and a 9000px one a blur,
     while linear scaling would spend 30x as long on a trip that is only
     perceptually a few times further. The constants are set so measured
     travel time matches what native smooth-scroll took at every real
     distance on this site (300px -> 450ms, 5670 -> 1.20s, 9368 -> 1.50s);
     only the speed profile within that time changed. */
  const scrollDuration = function (dist) {
    return Math.max(450, Math.min(16 * Math.sqrt(Math.abs(dist)), SCROLL_MAX_MS));
  };

  const maxScrollTop = function () {
    const de = document.documentElement;
    return Math.max(0, de.scrollHeight - de.clientHeight);
  };

  /* What the browser itself would have landed on: the target's top aligned to
     the viewport top, less its own scroll-margin-top. Read from the computed
     style rather than recomputed here, so the CSS stays the single source of
     the header offset and the landing position cannot drift from it. */
  const anchorTargetY = function (el) {
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop);
    const y = el.getBoundingClientRect().top + window.pageYOffset -
      (isNaN(margin) ? 0 : margin);
    return Math.max(0, Math.min(Math.round(y), maxScrollTop()));
  };

  let anchorScrolling = false;
  let anchorFrame = 0;
  let pendingFocus = null;

  const isAnchorScrolling = function () { return anchorScrolling; };

  const finishAnchorScroll = function () {
    if (anchorFrame) { cancelAnimationFrame(anchorFrame); anchorFrame = 0; }
    anchorScrolling = false;

    /* A real anchor jump moves focus to the target; without this a keyboard
       or screen-reader user is left reading from wherever they were. Deferred
       to the end so the focus ring does not appear mid-flight, and the
       tabindex is withdrawn on blur so sections never become tab stops. */
    const target = pendingFocus;
    pendingFocus = null;
    if (target) {
      if (!target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
        target.addEventListener('blur', function () {
          target.removeAttribute('tabindex');
        }, { once: true });
      }
      target.focus({ preventScroll: true });
    }

    /* Fires on arrival *and* on interruption, so a listener can never be left
       waiting. Preferred to `scrollend` by the scrollspy locks below: that
       event is absent in older Safari, and it also fires for the horizontal
       pill rows, which finish long before the page does. */
    window.dispatchEvent(new CustomEvent('anchorscrollend'));
  };

  const scrollToY = function (y) {
    if (anchorFrame) { cancelAnimationFrame(anchorFrame); anchorFrame = 0; }

    const start = window.pageYOffset;
    const dist = y - start;

    if (reduceMotion.matches || Math.abs(dist) < 2) {
      window.scrollTo({ top: y, behavior: 'instant' });
      finishAnchorScroll();
      return;
    }

    const dur = scrollDuration(dist);
    /* Stamped now, not on the first frame: starting the clock inside rAF
       spends that frame at progress 0, which reads as a beat of lag between
       the click and anything moving. */
    const t0 = performance.now();
    anchorScrolling = true;

    const step = function () {
      const p = Math.min(1, (performance.now() - t0) / dur);
      window.scrollTo({ top: start + dist * easeScroll(p), behavior: 'instant' });
      if (p < 1) anchorFrame = requestAnimationFrame(step);
      else finishAnchorScroll();
    };

    anchorFrame = requestAnimationFrame(step);
  };

  const cancelAnchorScroll = function () {
    if (anchorScrolling) finishAnchorScroll();
  };

  /* A real gesture always wins over an in-flight programmatic scroll. Only
     keys that actually scroll count: Tab and Enter are how a keyboard user
     reaches and fires the link in the first place. */
  const SCROLL_KEYS = {
    ArrowUp: 1, ArrowDown: 1, PageUp: 1, PageDown: 1,
    Home: 1, End: 1, ' ': 1, Spacebar: 1
  };

  ['wheel', 'touchstart'].forEach(function (evt) {
    window.addEventListener(evt, cancelAnchorScroll, { passive: true });
  });
  window.addEventListener('keydown', function (e) {
    if (SCROLL_KEYS[e.key]) cancelAnchorScroll();
  }, { passive: true });

  /* Delegated rather than bound per link, so every in-page anchor on every
     page gets the same motion -- a footer link that scrolls differently from
     the nav above it is exactly the kind of seam this is meant to remove.
     Bubble phase, so a link's own handler (drawer close, instant highlight)
     has already run and the layout it changed is measured, not guessed. */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;

    const id = href.slice(1);
    const target = id ? document.getElementById(id) : null;
    // A dangling anchor is left to the browser rather than silently swallowed.
    if (id && !target) return;

    e.preventDefault();
    pendingFocus = target;
    scrollToY(target ? anchorTargetY(target) : 0);

    /* pushState, not `location.hash = ...`: assigning the hash makes the
       browser jump to the target itself, which would race the animation.
       Bare "#" is left out of history -- it is the logo's scroll-to-top, not
       a place. */
    if (id && location.hash !== href) history.pushState(null, '', href);
  });

  const menuToggle = document.querySelector('.menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  let onMenuToggle = null;

  if (menuToggle && mobileNav) {
    menuToggle.addEventListener('click', function () {
      const isOpen = mobileNav.classList.toggle('mobile-nav-open');
      menuToggle.classList.toggle('menu-toggle-open', isOpen);
      menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      menuToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
      if (onMenuToggle) onMenuToggle(isOpen);
    });

    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileNav.classList.remove('mobile-nav-open');
        menuToggle.classList.remove('menu-toggle-open');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.setAttribute('aria-label', 'Open menu');
        if (onMenuToggle) onMenuToggle(false);
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * "For you" segment tabs: swap the card content per audience. Only
   * switches to a panel that actually exists, so a tab whose content hasn't
   * been built yet (e.g. Retailers) is inert rather than showing nothing.
   * ------------------------------------------------------------------ */

  const segmentTabs = Array.prototype.slice.call(document.querySelectorAll('.segment-tab'));
  const segmentPanels = Array.prototype.slice.call(document.querySelectorAll('[data-segment-panel]'));

  const segmentTabsRow = document.querySelector('.segments-tabs');

  /* ---- overflow affordance -------------------------------------------- *
   * On mobile the row is a hidden-scrollbar horizontal scroller and the last
   * tab sits fully off-screen, so without a cue the set reads as complete at
   * two. CSS owns the fade; this only reports how much is left to scroll on
   * each side. Both flags are false whenever the row fits (i.e. on desktop),
   * so the mask stays fully opaque there.
   * ---------------------------------------------------------------------- */

  const syncSegmentFades = function () {
    if (!segmentTabsRow) return;
    const max = segmentTabsRow.scrollWidth - segmentTabsRow.clientWidth;
    const left = segmentTabsRow.scrollLeft;
    // 1px of slack: fractional scrollLeft otherwise leaves a fade at the end.
    segmentTabsRow.classList.toggle('segments-tabs-fade-start', max > 1 && left > 1);
    segmentTabsRow.classList.toggle('segments-tabs-fade-end', max > 1 && left < max - 1);
  };

  /* Keeps a tab that was activated without being touched (deep link, keyboard,
     a future programmatic switch) from staying parked out of sight. */
  const revealSegmentTab = function (tab, instant) {
    if (!segmentTabsRow || !tab) return;
    const max = segmentTabsRow.scrollWidth - segmentTabsRow.clientWidth;
    if (max <= 0) return;

    const rowRect = segmentTabsRow.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const center = (tabRect.left - rowRect.left) + segmentTabsRow.scrollLeft + tabRect.width / 2;
    const target = Math.max(0, Math.min(center - rowRect.width / 2, max));

    if (Math.abs(target - segmentTabsRow.scrollLeft) < 1) return;
    // No behavior passed for the animated case: the container's CSS
    // scroll-behavior owns it, so prefers-reduced-motion is honoured there.
    segmentTabsRow.scrollTo(instant ? { left: target, behavior: 'instant' } : { left: target });
  };

  if (segmentTabsRow) {
    let fadeFrame = 0;
    segmentTabsRow.addEventListener('scroll', function () {
      if (fadeFrame) return;
      fadeFrame = requestAnimationFrame(function () {
        fadeFrame = 0;
        syncSegmentFades();
      });
    }, { passive: true });

    window.addEventListener('resize', syncSegmentFades);
    syncSegmentFades();
    revealSegmentTab(segmentTabsRow.querySelector('.segment-tab-active'), true);
  }

  if (segmentTabs.length && segmentPanels.length) {
    segmentTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        const id = tab.getAttribute('data-segment');
        const panel = segmentPanels.filter(function (p) { return p.getAttribute('data-segment-panel') === id; })[0];
        if (!panel) return;

        segmentTabs.forEach(function (t) { t.classList.toggle('segment-tab-active', t === tab); });
        segmentPanels.forEach(function (p) { p.hidden = p !== panel; });
        revealSegmentTab(tab);
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Homepage nav: scrollspy active-link highlighting (desktop underline
   * sweep, mobile drawer pill). Click sets the active link immediately so
   * the highlight doesn't lag behind the smooth-scroll animation.
   * ------------------------------------------------------------------ */

  /* The two header actions are scrollspy targets in their own right: each one
     owns a section the nav row does not link to, so it is the thing that
     should light up while the reader is inside it. They are collected here
     rather than styled separately so one pass drives every "you are here"
     state in the header. */
  const homeNavLinks = Array.prototype.slice.call(
    document.querySelectorAll(
      '.nav-links a, .request-demo, .get-app-btn, .mobile-nav a'
    )
  );

  if (homeNavLinks.length) {
    const homeSections = homeNavLinks
      .map(function (link) { return document.getElementById(link.getAttribute('href').slice(1)); })
      .filter(function (section, i, arr) { return section && arr.indexOf(section) === i; });

    if (homeSections.length) {
      /* The desktop row's active fill is one shared element that travels
         between links; the CSS only knows how to animate it, the geometry
         has to be measured here. */
      const homeNavRow = document.querySelector('.nav-links');
      let navPill = null;

      if (homeNavRow) {
        navPill = document.createElement('span');
        navPill.className = 'nav-pill';
        navPill.setAttribute('aria-hidden', 'true');
        homeNavRow.appendChild(navPill);
        homeNavRow.classList.add('has-nav-pill');
      }

      const moveNavPill = function (animate) {
        if (!navPill) return;

        const target = homeNavRow.querySelector('a.nav-link-active');
        /* offsetParent is null while the row is display:none (mobile). */
        if (!target || !target.offsetParent) {
          navPill.classList.remove('nav-pill-visible');
          return;
        }

        /* Travelling in from nowhere would read as a swipe across the row,
           so a pill that is currently hidden is placed before it fades up. */
        const jump = !animate || !navPill.classList.contains('nav-pill-visible');
        if (jump) navPill.classList.add('nav-pill-instant');

        navPill.style.width = target.offsetWidth + 'px';
        navPill.style.height = target.offsetHeight + 'px';
        navPill.style.transform =
          'translate(' + target.offsetLeft + 'px, ' + target.offsetTop + 'px)';

        if (jump) {
          void navPill.offsetWidth;
          navPill.classList.remove('nav-pill-instant');
        }

        navPill.classList.add('nav-pill-visible');
      };

      const setHomeActive = function (id) {
        homeNavLinks.forEach(function (link) {
          link.classList.toggle('nav-link-active', link.getAttribute('href') === '#' + id);
        });
        moveNavPill(true);
      };

      /* Walking only the linked sections cannot tell "not scrolled to a section
         yet" from "scrolled past one into a section nothing in the header
         links to" -- the footer -- so the last linked section passed stayed
         lit all the way down. Walking every landmark and then rejecting
         unlinked ones lets the highlight go out where it should. Landmarks are
         in document order, so the walk can stop at the first one below the
         line; homeSections is in header order, hence membership not index. */
      let homeLandmarks = Array.prototype.slice.call(
        document.querySelectorAll('section[id], footer[id]')
      ).filter(function (el, i, arr) {
        return arr.slice(0, i).every(function (prev) { return prev !== el; });
      });
      let firstTracked = homeLandmarks.length;
      homeSections.forEach(function (s) {
        const i = homeLandmarks.indexOf(s);
        if (i !== -1 && i < firstTracked) firstTracked = i;
      });
      if (firstTracked > 0 && firstTracked < homeLandmarks.length) {
        homeLandmarks = homeLandmarks.slice(firstTracked);
      }

      const currentHomeSectionId = function () {
        const line = 100;
        let current = null;
        for (let i = 0; i < homeLandmarks.length; i++) {
          if (homeLandmarks[i].getBoundingClientRect().top <= line) current = homeLandmarks[i];
          else break;
        }
        /* No "at the document bottom, force the last link active" case: the
           bottom of this document is the footer, which nothing links to, so
           the honest answer down there is none. */
        return current && homeSections.indexOf(current) !== -1 ? current.id : null;
      };

      let homeTicking = false;
      const updateHomeActive = function () {
        homeTicking = false;
        const id = currentHomeSectionId();
        if (id) {
          setHomeActive(id);
        } else {
          homeNavLinks.forEach(function (link) { link.classList.remove('nav-link-active'); });
          moveNavPill(true);
        }
      };

      /* A click's target is authoritative, but the resulting scroll takes
         hundreds of ms, and every section boundary it passes en route
         re-fires the listener below with whatever is briefly under the
         viewport line -- so a click on "How it works" was observed to set
         the pill in motion, get yanked back to the section it started from,
         then sweep forward through each section it scrolled past before
         settling. Locking out the scroll listener for the duration of a
         click-initiated scroll makes the pill travel straight to the clicked
         target in one motion. */
      let homeNavScrollLock = false;
      let homeNavScrollLockTimer = null;
      const releaseHomeNavScrollLock = function () {
        homeNavScrollLock = false;
        window.removeEventListener('anchorscrollend', releaseHomeNavScrollLock);
        if (homeNavScrollLockTimer) { clearTimeout(homeNavScrollLockTimer); homeNavScrollLockTimer = null; }
        updateHomeActive();
      };

      window.addEventListener('scroll', function () {
        if (homeNavScrollLock) return;
        if (homeTicking) return;
        homeTicking = true;
        requestAnimationFrame(updateHomeActive);
      }, { passive: true });

      homeNavLinks.forEach(function (link) {
        link.addEventListener('click', function () {
          const id = link.getAttribute('href').slice(1);
          if (!document.getElementById(id)) return;
          setHomeActive(id);
          homeNavScrollLock = true;
          /* `anchorscrollend` fires the moment our own animator stops, whether
             it arrived or the reader grabbed the page, so the lock now tracks
             the actual flight instead of the old `scrollend` guess. The timer
             is only a backstop for a click this module handled but the
             delegated scroller did not; sized off the animator's own ceiling,
             since a timeout shorter than a real flight was what released the
             lock mid-scroll and made the highlight snap backwards before. */
          window.addEventListener('anchorscrollend', releaseHomeNavScrollLock, { once: true });
          if (homeNavScrollLockTimer) clearTimeout(homeNavScrollLockTimer);
          homeNavScrollLockTimer = setTimeout(releaseHomeNavScrollLock, SCROLL_MAX_MS + 400);
        });
      });

      let navPillResizeTicking = false;
      window.addEventListener('resize', function () {
        if (navPillResizeTicking) return;
        navPillResizeTicking = true;
        requestAnimationFrame(function () {
          navPillResizeTicking = false;
          moveNavPill(false);
        });
      });

      updateHomeActive();

      /* Switzer swaps in after first paint and changes the link widths. */
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { moveNavPill(false); });
      }
    }
  }

  document.querySelectorAll('.faq-item').forEach(function (item) {
    item.addEventListener('click', function () {
      const isOpen = item.classList.contains('faq-item-open');
      document.querySelectorAll('.faq-item').forEach(function (other) {
        other.classList.remove('faq-item-open');
        other.setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        item.classList.add('faq-item-open');
        item.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ------------------------------------------------------------------ *
   * Legal page contents nav: scrollspy + mobile docking sub-nav.
   *
   * A single rAF-throttled pass owns every piece of derived state
   * (docked / hidden / active section), so they can never disagree with
   * each other or with the scroll position mid-frame.
   * ------------------------------------------------------------------ */

  const tocNav = document.querySelector('.legal-toc');
  const tocLinks = tocNav
    ? Array.prototype.slice.call(tocNav.querySelectorAll('.legal-toc-link'))
    : [];

  if (!tocNav || !tocLinks.length) return;

  const root = document.documentElement;
  const header = document.querySelector('.header-nav');
  const sentinel = document.querySelector('.legal-toc-sentinel');
  const spacer = document.querySelector('.legal-toc-spacer');
  const siteFooter = document.querySelector('.site-footer');

  const sections = tocLinks
    .map(function (link) { return document.getElementById(link.getAttribute('href').slice(1)); })
    .filter(Boolean);

  if (!sections.length) return;

  const mobileQuery = window.matchMedia('(max-width: 640px)');
  const isMobile = function () { return mobileQuery.matches; };
  let userScrolled = false;
  const viewport = window.visualViewport || null;

  /* ---- viewport basis ------------------------------------------------ *
   * Everything below compares against getBoundingClientRect(), which is
   * always in layout-viewport CSS pixels. window.innerHeight is NOT: in
   * mobile Safari it reports the *visual* viewport, so a pinch shrinks it
   * (and fires resize). Mixing the two made zooming silently rewrite the
   * footer-hide threshold and the end-of-document test -- the bar would fly
   * back in mid-gesture. documentElement.clientHeight is the layout viewport
   * everywhere and is unaffected by zoom.
   * -------------------------------------------------------------------- */

  const viewportHeight = function () { return root.clientHeight || window.innerHeight; };
  const maxScrollY = function () { return Math.max(0, root.scrollHeight - viewportHeight()); };

  // Treated as "the user is pinched in". Scale is fractional mid-gesture, so
  // the threshold has slack rather than testing !== 1.
  const isZoomed = function () { return !!viewport && viewport.scale > 1.02; };

  /* ---- measurement -------------------------------------------------- *
   * The in-flow bar and the docked bar are deliberately given the same box
   * by the mobile CSS, so one measurement is valid in both states and the
   * spacer can never introduce a layout jump.
   * ------------------------------------------------------------------- */

  let headerHeight = 72;
  let barHeight = 59;

  const applyMetrics = function () {
    if (header) headerHeight = Math.round(header.offsetHeight) || headerHeight;
    root.style.setProperty('--legal-header-h', headerHeight + 'px');

    if (isMobile()) {
      barHeight = Math.round(tocNav.offsetHeight) || barHeight;
      root.style.setProperty('--legal-toc-h', barHeight + 'px');
      if (spacer) spacer.style.height = barHeight + 'px';
    } else {
      // The tall vertical desktop list has nothing to do with the docked bar.
      root.style.removeProperty('--legal-toc-h');
      if (spacer) spacer.style.height = '';
    }
  };

  /* The line a section's top must reach to count as the current one. CSS
     owns the number via scroll-margin-top, so the highlight and the scroll
     landing position can never drift apart. */
  const referenceLine = function () {
    const margin = parseFloat(getComputedStyle(sections[0]).scrollMarginTop);
    return (isNaN(margin) ? 100 : margin) + 4;
  };

  /* ---- horizontal auto-centering ------------------------------------ */

  const centerLink = function (link, smooth) {
    // Never scroll the pill row while the user is pinching: the bar is under
    // their fingers and a programmatic sideways jump reads as the page
    // fighting them.
    if (!link || !isMobile() || isZoomed()) return;
    const maxScroll = tocNav.scrollWidth - tocNav.clientWidth;
    if (maxScroll <= 0) return;

    const navRect = tocNav.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const linkCenter = (linkRect.left - navRect.left) + tocNav.scrollLeft + linkRect.width / 2;
    const target = Math.max(0, Math.min(linkCenter - navRect.width / 2, maxScroll));

    if (Math.abs(target - tocNav.scrollLeft) < 1) return;
    tocNav.scrollTo({ left: target, behavior: smooth === false ? 'instant' : 'smooth' });
  };

  /* ---- active section ------------------------------------------------ */

  let activeId = null;

  const setActive = function (id, smoothCenter) {
    if (!id || id === activeId) return;
    activeId = id;
    let activeLink = null;
    tocLinks.forEach(function (link) {
      const on = link.getAttribute('href') === '#' + id;
      link.classList.toggle('legal-toc-active', on);
      if (on) {
        activeLink = link;
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });
    centerLink(activeLink, smoothCenter);
  };

  const currentSectionId = function () {
    const line = referenceLine();

    // At the very bottom of the document the last sections can never reach
    // the reading line, so honour the scroll end explicitly.
    if (window.pageYOffset >= maxScrollY() - 2) {
      return sections[sections.length - 1].id;
    }

    let current = sections[0];
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= line) current = sections[i];
      else break;
    }
    return current.id;
  };

  /* ---- docking + footer hide ----------------------------------------- */

  let stuck = false;
  let hidden = false;
  let menuOpen = false;

  const updateChrome = function () {
    if (!isMobile()) {
      if (stuck) {
        stuck = false;
        tocNav.classList.remove('legal-toc-stuck');
        if (spacer) spacer.classList.remove('legal-toc-spacer-active');
      }
      if (hidden) {
        hidden = false;
        tocNav.classList.remove('legal-toc-hidden');
      }
      return;
    }

    /* Nothing above the bar moves when it docks (the spacer that replaces it
       sits below and is exactly its height), and the sentinel sits above both,
       so the sentinel's position is stable and this test cannot oscillate.

       The zoom term: a position:fixed box is laid out against the *layout*
       viewport, so while the user is pinched in it is painted at the zoom
       scale over wherever they have panned to - a giant bar swimming across
       the content, pinned to nothing they can see. Undocking releases it back
       into the article for the duration of the zoom, and because the spacer is
       withdrawn in the same frame the page underneath does not move at all. */
    if (sentinel && spacer) {
      const shouldStick = sentinel.getBoundingClientRect().top <= headerHeight && !isZoomed();
      if (shouldStick !== stuck) {
        stuck = shouldStick;
        // Both applied in the same frame: no intermediate layout is painted.
        spacer.classList.toggle('legal-toc-spacer-active', stuck);
        tocNav.classList.toggle('legal-toc-stuck', stuck);
      }
    }

    // Retire the bar once the footer owns the screen - there is nothing left
    // to navigate to. Asymmetric thresholds keep it from flickering when the
    // user lingers on the boundary.
    let shouldHide = menuOpen;
    if (!shouldHide && siteFooter) {
      const footerTop = siteFooter.getBoundingClientRect().top;
      const vh = viewportHeight();
      shouldHide = hidden ? footerTop < vh * 0.62 : footerTop < vh * 0.5;
    }
    if (shouldHide !== hidden) {
      hidden = shouldHide;
      tocNav.classList.toggle('legal-toc-hidden', hidden);
    }
  };

  onMenuToggle = function (open) {
    menuOpen = open;
    updateChrome();
  };

  /* ---- scroll pass ---------------------------------------------------- *
   * While a click-driven smooth scroll is in flight the spy is muted, so the
   * tapped item stays lit instead of strobing through every section the page
   * flies past on the way there.
   * --------------------------------------------------------------------- */

  let spyMuted = false;
  let muteTimer = null;
  let pendingTarget = -1;

  const unmute = function () {
    if (!spyMuted) return;
    spyMuted = false;
    pendingTarget = -1;
    clearTimeout(muteTimer);
    window.removeEventListener('anchorscrollend', unmute);
    setActive(currentSectionId());
  };

  const mute = function (targetY) {
    spyMuted = true;
    pendingTarget = targetY;
    clearTimeout(muteTimer);
    /* Keyed off the animator finishing rather than a flat timeout: the long
       hops on these pages outlast the 1200ms this used to wait, which would
       unmute mid-flight and strobe the pill through the sections in between. */
    window.addEventListener('anchorscrollend', unmute, { once: true });
    muteTimer = setTimeout(unmute, SCROLL_MAX_MS + 400);
  };

  let ticking = false;

  const update = function () {
    updateChrome();
    if (spyMuted) {
      if (pendingTarget >= 0 && Math.abs(window.pageYOffset - pendingTarget) <= 2) unmute();
      return;
    }
    setActive(currentSectionId());
  };

  const onScroll = function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      update();
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });

  // The nav's own horizontal centering scroll also raises scrollend at the
  // window, and it finishes long before the page scroll does - honouring it
  // would unmute the spy mid-flight and flash an intermediate section. A
  // dropped frame mid-flight can likewise look like the page settling, so an
  // anchor scroll in progress is left to announce its own end.
  if ('onscrollend' in window) {
    window.addEventListener('scrollend', function (e) {
      if (isAnchorScrolling()) return;
      if (e.target === document || e.target === root) unmute();
    }, { passive: true });
  }

  // A real gesture always wins over an in-flight programmatic scroll.
  ['wheel', 'touchstart', 'keydown'].forEach(function (evt) {
    window.addEventListener(evt, function () {
      userScrolled = true;
      unmute();
    }, { passive: true });
  });

  const onResize = function () {
    applyMetrics();
    update();
    centerLink(tocNav.querySelector('.legal-toc-active'), false);
  };
  window.addEventListener('resize', onResize, { passive: true });
  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onResize);

  /* ---- pinch-zoom ------------------------------------------------------ *
   * The visual viewport is the only thing that actually moves during a pinch,
   * and it is the only API that reports it in every engine (mobile Safari
   * also fires window resize, Chrome does not). Docking is re-evaluated live
   * so the bar releases the moment the zoom starts, but re-measuring is left
   * until the gesture settles: offsetHeight is stable under zoom, so running
   * it mid-pinch is pure churn.
   * ---------------------------------------------------------------------- */

  if (viewport) {
    let settleTimer = null;

    const onViewportChange = function () {
      onScroll();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        applyMetrics();
        update();
        centerLink(tocNav.querySelector('.legal-toc-active'), false);
      }, 160);
    };

    viewport.addEventListener('resize', onViewportChange, { passive: true });
    viewport.addEventListener('scroll', onViewportChange, { passive: true });
  }

  // Belt and suspenders: whatever actually changes the bar's rendered height
  // (a late font swap, iOS dynamic type, an orientation flip) re-syncs the
  // spacer directly, instead of relying on catching every possible cause.
  if (typeof ResizeObserver === 'function') {
    const tocResizeObserver = new ResizeObserver(function () {
      applyMetrics();
    });
    tocResizeObserver.observe(tocNav);
  }

  /* ---- clicks ---------------------------------------------------------- */

  /* No preventDefault here either: the delegated scroller at the top of this
     file already owns the motion, the scroll-margin-top offset and the URL.
     All this adds is the instant highlight and the mute window. */
  tocLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;

      userScrolled = true;
      setActive(id);

      const y = target.getBoundingClientRect().top + window.pageYOffset - referenceLine() + 4;
      mute(Math.max(0, Math.min(Math.round(y), maxScrollY())));
    });
  });

  /* ---- deep links (page opened straight at #section) -------------------- *
   * The browser scrolls to the hash before webfonts and images have settled,
   * so everything above the target can still change height afterwards.
   * Rather than defending against that with timers, re-pin the target at the
   * few moments the layout is known to have changed, using an *instant*
   * scroll - which is idempotent and invisible.
   *
   * (The previous code used window.scrollTo(x, y), which the global
   * `scroll-behavior: smooth` silently turned into an animation, so its
   * repeated corrections fought each other. That, not the network, is what
   * produced the inconsistent landing positions.)
   * ---------------------------------------------------------------------- */

  const pinToHash = function () {
    if (userScrolled) return;
    const id = location.hash.slice(1);
    const target = id && document.getElementById(id);
    if (!target || sections.indexOf(target) === -1) return;

    const y = Math.max(0, Math.min(
      Math.round(target.getBoundingClientRect().top + window.pageYOffset - referenceLine() + 4),
      maxScrollY()
    ));
    if (Math.abs(window.pageYOffset - y) > 1) window.scrollTo({ top: y, behavior: 'instant' });
    setActive(id, false);
  };

  const settle = function () {
    // Re-measure every time: a webfont swap or late image load can change the
    // bar's real height well after the first paint, and the spacer must track
    // it exactly or whatever comes right after the bar ends up underneath it.
    applyMetrics();
    pinToHash();
    update();
  };

  applyMetrics();
  updateChrome();
  setActive(currentSectionId(), false);
  requestAnimationFrame(settle);

  window.addEventListener('load', function () {
    settle();
    requestAnimationFrame(settle);
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      requestAnimationFrame(settle);
    });
  }
});
