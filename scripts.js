document.addEventListener('DOMContentLoaded', function () {
  var menuToggle = document.querySelector('.menu-toggle');
  var mobileNav = document.getElementById('mobile-nav');
  var onMenuToggle = null;

  if (menuToggle && mobileNav) {
    menuToggle.addEventListener('click', function () {
      var isOpen = mobileNav.classList.toggle('mobile-nav-open');
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

  document.querySelectorAll('.faq-item').forEach(function (item) {
    item.addEventListener('click', function () {
      var isOpen = item.classList.contains('faq-item-open');
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

  var tocNav = document.querySelector('.legal-toc');
  var tocLinks = tocNav
    ? Array.prototype.slice.call(tocNav.querySelectorAll('.legal-toc-link'))
    : [];

  if (!tocNav || !tocLinks.length) return;

  var root = document.documentElement;
  var header = document.querySelector('.header-nav');
  var sentinel = document.querySelector('.legal-toc-sentinel');
  var spacer = document.querySelector('.legal-toc-spacer');
  var siteFooter = document.querySelector('.site-footer');

  var sections = tocLinks
    .map(function (link) { return document.getElementById(link.getAttribute('href').slice(1)); })
    .filter(Boolean);

  if (!sections.length) return;

  var mobileQuery = window.matchMedia('(max-width: 640px)');
  var isMobile = function () { return mobileQuery.matches; };
  var userScrolled = false;
  var viewport = window.visualViewport || null;

  /* ---- viewport basis ------------------------------------------------ *
   * Everything below compares against getBoundingClientRect(), which is
   * always in layout-viewport CSS pixels. window.innerHeight is NOT: in
   * mobile Safari it reports the *visual* viewport, so a pinch shrinks it
   * (and fires resize). Mixing the two made zooming silently rewrite the
   * footer-hide threshold and the end-of-document test -- the bar would fly
   * back in mid-gesture. documentElement.clientHeight is the layout viewport
   * everywhere and is unaffected by zoom.
   * -------------------------------------------------------------------- */

  var viewportHeight = function () { return root.clientHeight || window.innerHeight; };
  var maxScrollY = function () { return Math.max(0, root.scrollHeight - viewportHeight()); };

  // Treated as "the user is pinched in". Scale is fractional mid-gesture, so
  // the threshold has slack rather than testing !== 1.
  var isZoomed = function () { return !!viewport && viewport.scale > 1.02; };

  /* ---- measurement -------------------------------------------------- *
   * The in-flow bar and the docked bar are deliberately given the same box
   * by the mobile CSS, so one measurement is valid in both states and the
   * spacer can never introduce a layout jump.
   * ------------------------------------------------------------------- */

  var headerHeight = 72;
  var barHeight = 59;

  var applyMetrics = function () {
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
  var referenceLine = function () {
    var margin = parseFloat(getComputedStyle(sections[0]).scrollMarginTop);
    return (isNaN(margin) ? 100 : margin) + 4;
  };

  /* ---- horizontal auto-centering ------------------------------------ */

  var centerLink = function (link, smooth) {
    // Never scroll the pill row while the user is pinching: the bar is under
    // their fingers and a programmatic sideways jump reads as the page
    // fighting them.
    if (!link || !isMobile() || isZoomed()) return;
    var maxScroll = tocNav.scrollWidth - tocNav.clientWidth;
    if (maxScroll <= 0) return;

    var navRect = tocNav.getBoundingClientRect();
    var linkRect = link.getBoundingClientRect();
    var linkCenter = (linkRect.left - navRect.left) + tocNav.scrollLeft + linkRect.width / 2;
    var target = Math.max(0, Math.min(linkCenter - navRect.width / 2, maxScroll));

    if (Math.abs(target - tocNav.scrollLeft) < 1) return;
    tocNav.scrollTo({ left: target, behavior: smooth === false ? 'instant' : 'smooth' });
  };

  /* ---- active section ------------------------------------------------ */

  var activeId = null;

  var setActive = function (id, smoothCenter) {
    if (!id || id === activeId) return;
    activeId = id;
    var activeLink = null;
    tocLinks.forEach(function (link) {
      var on = link.getAttribute('href') === '#' + id;
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

  var currentSectionId = function () {
    var line = referenceLine();

    // At the very bottom of the document the last sections can never reach
    // the reading line, so honour the scroll end explicitly.
    if (window.pageYOffset >= maxScrollY() - 2) {
      return sections[sections.length - 1].id;
    }

    var current = sections[0];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= line) current = sections[i];
      else break;
    }
    return current.id;
  };

  /* ---- docking + footer hide ----------------------------------------- */

  var stuck = false;
  var hidden = false;
  var menuOpen = false;

  var updateChrome = function () {
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
      var shouldStick = sentinel.getBoundingClientRect().top <= headerHeight && !isZoomed();
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
    var shouldHide = menuOpen;
    if (!shouldHide && siteFooter) {
      var footerTop = siteFooter.getBoundingClientRect().top;
      var vh = viewportHeight();
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

  var spyMuted = false;
  var muteTimer = null;
  var pendingTarget = -1;

  var unmute = function () {
    if (!spyMuted) return;
    spyMuted = false;
    pendingTarget = -1;
    clearTimeout(muteTimer);
    setActive(currentSectionId());
  };

  var mute = function (targetY) {
    spyMuted = true;
    pendingTarget = targetY;
    clearTimeout(muteTimer);
    muteTimer = setTimeout(unmute, 1200);
  };

  var ticking = false;

  var update = function () {
    updateChrome();
    if (spyMuted) {
      if (pendingTarget >= 0 && Math.abs(window.pageYOffset - pendingTarget) <= 2) unmute();
      return;
    }
    setActive(currentSectionId());
  };

  var onScroll = function () {
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
  // would unmute the spy mid-flight and flash an intermediate section.
  if ('onscrollend' in window) {
    window.addEventListener('scrollend', function (e) {
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

  var onResize = function () {
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
    var settleTimer = null;

    var onViewportChange = function () {
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
    var tocResizeObserver = new ResizeObserver(function () {
      applyMetrics();
    });
    tocResizeObserver.observe(tocNav);
  }

  /* ---- clicks ---------------------------------------------------------- */

  /* No preventDefault: the browser's own anchor navigation already honours
     scroll-margin-top and keeps the URL and history correct. All this adds
     is the instant highlight and the mute window. */
  tocLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      var id = link.getAttribute('href').slice(1);
      var target = document.getElementById(id);
      if (!target) return;

      userScrolled = true;
      setActive(id);

      var y = target.getBoundingClientRect().top + window.pageYOffset - referenceLine() + 4;
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

  var pinToHash = function () {
    if (userScrolled) return;
    var id = location.hash.slice(1);
    var target = id && document.getElementById(id);
    if (!target || sections.indexOf(target) === -1) return;

    var y = Math.max(0, Math.min(
      Math.round(target.getBoundingClientRect().top + window.pageYOffset - referenceLine() + 4),
      maxScrollY()
    ));
    if (Math.abs(window.pageYOffset - y) > 1) window.scrollTo({ top: y, behavior: 'instant' });
    setActive(id, false);
  };

  var settle = function () {
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
