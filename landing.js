/* ==========================================================================
   COMMUTE GUIDE PH — LANDING PAGE SCRIPT
   Handles: animated hero canvas, dark mode toggle, scroll-reveal
   animations, and the hero search redirect into the map screen.
   No external dependencies — vanilla JS only.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     UTIL: respect prefers-reduced-motion for anything JS-driven
     (CSS transitions are already handled globally in variables.css)
     ------------------------------------------------------------------ */
  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  /* ==================================================================
     1. DARK MODE TOGGLE
     Persists choice in localStorage under 'cgph-theme'.
     Falls back to the OS-level color scheme on first visit.
     ================================================================== */
  const THEME_KEY = 'cgph-theme';
  const darkModeToggle = document.getElementById('darkModeToggle');
  const rootEl = document.documentElement;

  function getInitialTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    // No saved preference yet — respect the OS setting
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      rootEl.setAttribute('data-theme', 'dark');
      if (darkModeToggle) {
        darkModeToggle.querySelector('.material-icons-round').textContent =
          'light_mode';
        darkModeToggle.setAttribute('aria-label', 'Switch to light mode');
      }
    } else {
      rootEl.removeAttribute('data-theme');
      if (darkModeToggle) {
        darkModeToggle.querySelector('.material-icons-round').textContent =
          'dark_mode';
        darkModeToggle.setAttribute('aria-label', 'Switch to dark mode');
      }
    }
  }

  let currentTheme = getInitialTheme();
  applyTheme(currentTheme);

  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(currentTheme);
      localStorage.setItem(THEME_KEY, currentTheme);
      // Re-tint the canvas immediately so it doesn't lag one frame behind.
      // Defined in section 4 below and attached to window since it's
      // declared inside a conditional block (out of this scope otherwise).
      if (typeof window.updateCanvasThemeColors === 'function') {
        window.updateCanvasThemeColors();
      }
    });
  }

  /* ==================================================================
     2. HERO SEARCH — redirect into the map/home screen
     The home screen (home.html) reads `?dest=` on load and kicks off
     a search automatically, so the user's intent carries through.
     ================================================================== */
  const heroSearchForm = document.getElementById('heroSearchForm');
  const heroSearchInput = document.getElementById('heroSearchInput');

  if (heroSearchForm) {
    heroSearchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = heroSearchInput.value.trim();
      const destination = query.length > 0 ? query : '';
     const url = destination
  ? `home.html?dest=${encodeURIComponent(destination)}&view=guide`
  : 'home.html?view=guide';

window.location.href = url;
    });
  }

  /* ==================================================================
     3. SCROLL-REVEAL ANIMATIONS
     Rather than hand-adding data-reveal to every element in the HTML,
     we tag the repeating card/step elements here, then observe them.
     Keeps index.html clean of animation-only markup.
     ================================================================== */
  const revealSelectors = [
    '.flow-step',
    '.feature-card',
    '.transport-chip',
    '.final-cta-inner',
  ];
  const revealTargets = document.querySelectorAll(revealSelectors.join(','));

  revealTargets.forEach((el) => el.setAttribute('data-reveal', ''));

  if (prefersReducedMotion) {
    // Show everything immediately — no observer needed
    revealTargets.forEach((el) => el.classList.add('is-visible'));
  } else if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target); // reveal once, then stop watching
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    revealTargets.forEach((el) => revealObserver.observe(el));
  } else {
    // No IntersectionObserver support — fail gracefully, show content
    revealTargets.forEach((el) => el.classList.add('is-visible'));
  }

  /* ==================================================================
     4. ANIMATED HERO MAP CANVAS
     A lightweight, dependency-free "map" made of a dot grid (roads /
     intersections) plus a single traveling gradient line (an active
     route). Deliberately simple so it stays performant on low-end
     Android devices, which is most of this app's real audience.
     ================================================================== */
  const canvas = document.getElementById('heroMapCanvas');

  if (canvas && !prefersReducedMotion) {
    const ctx = canvas.getContext('2d');
    let width, height, dpr;
    let dots = [];
    let routeProgress = 0; // 0 to 1, loops
    let animationFrameId = null;

    // Colors are re-read from CSS variables so the canvas matches the
    // active theme without needing its own color logic.
    let dotColor = 'rgba(99, 102, 241, 0.25)';
    let routeColor = '#F59E0B';

    function updateCanvasThemeColors() {
      const styles = getComputedStyle(document.documentElement);
      const primary = styles.getPropertyValue('--color-primary-500').trim();
      const accent = styles.getPropertyValue('--color-accent-500').trim();
      dotColor = hexToRgba(primary, 0.22);
      routeColor = accent || '#F59E0B';
    }

    function hexToRgba(hex, alpha) {
      const parsed = hex.replace('#', '');
      if (parsed.length !== 6) return `rgba(99, 102, 241, ${alpha})`;
      const r = parseInt(parsed.substring(0, 2), 16);
      const g = parseInt(parsed.substring(2, 4), 16);
      const b = parseInt(parsed.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function resizeCanvas() {
      dpr = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildDotGrid();
    }

    // Build a grid of dots representing intersections, with slight
    // random jitter so it doesn't look like a perfect spreadsheet.
    function buildDotGrid() {
      dots = [];
      const spacing = 46;
      const cols = Math.ceil(width / spacing) + 1;
      const rows = Math.ceil(height / spacing) + 1;

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          dots.push({
            x: i * spacing + (Math.random() * 10 - 5),
            y: j * spacing + (Math.random() * 10 - 5),
            r: Math.random() * 1.2 + 0.6,
          });
        }
      }
    }

    // A simple looping path (like a route) drawn as a smooth curve
    // across the hero, roughly diagonal, to suggest "a commute".
    function getRoutePoints() {
      return [
        { x: width * 0.05, y: height * 0.75 },
        { x: width * 0.28, y: height * 0.35 },
        { x: width * 0.55, y: height * 0.6 },
        { x: width * 0.8, y: height * 0.2 },
        { x: width * 1.02, y: height * 0.4 },
      ];
    }

    function drawDots() {
      ctx.fillStyle = dotColor;
      dots.forEach((dot) => {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Draws the full faint route line, then a brighter traveling
    // segment on top to suggest live movement along it.
    function drawRoute() {
      const points = getRoutePoints();

      // Faint full path
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const midX = (points[i - 1].x + points[i].x) / 2;
        const midY = (points[i - 1].y + points[i].y) / 2;
        ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, midX, midY);
      }
      ctx.strokeStyle = hexToRgba('#6366F1', 0.15);
      ctx.lineWidth = 2;
      ctx.stroke();

      // Traveling bright segment — a short arc that moves along the path
      const segmentLength = 0.12; // fraction of total path
      const start = routeProgress;
      const end = Math.min(routeProgress + segmentLength, 1);

      ctx.beginPath();
      const totalPoints = 60;
      let started = false;
      for (let i = 0; i <= totalPoints; i++) {
        const t = i / totalPoints;
        if (t < start || t > end) continue;
        const pt = getPointOnPath(points, t);
        if (!started) {
          ctx.moveTo(pt.x, pt.y);
          started = true;
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      }
      ctx.strokeStyle = routeColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.shadowColor = routeColor;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0; // reset so it doesn't bleed into dots
    }

    // Approximate a point at fraction t along the multi-segment path
    function getPointOnPath(points, t) {
      const segmentCount = points.length - 1;
      const segmentT = t * segmentCount;
      const segmentIndex = Math.min(Math.floor(segmentT), segmentCount - 1);
      const localT = segmentT - segmentIndex;
      const p0 = points[segmentIndex];
      const p1 = points[segmentIndex + 1];
      return {
        x: p0.x + (p1.x - p0.x) * localT,
        y: p0.y + (p1.y - p0.y) * localT,
      };
    }

    function animate() {
      ctx.clearRect(0, 0, width, height);
      drawDots();
      drawRoute();

      routeProgress += 0.0022;
      if (routeProgress > 1) routeProgress = -0.15; // loop with a pause off-path

      animationFrameId = requestAnimationFrame(animate);
    }

    // Pause the animation loop when the tab isn't visible — saves
    // battery/CPU on mobile, which matters for this app's audience.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
      } else {
        animate();
      }
    });

    updateCanvasThemeColors();
    resizeCanvas();
    animate();

    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(resizeCanvas, 150); // debounce
    });

    // Expose so the dark mode toggle handler (defined above) can call it
    window.updateCanvasThemeColors = updateCanvasThemeColors;
  } else {
    // Reduced motion or no canvas support — provide a no-op so the
    // dark mode toggle's call to it doesn't throw.
    window.updateCanvasThemeColors = function () {};
  }
})();
