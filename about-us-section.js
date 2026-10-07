// about-us-section.js — reusable "About Us" founder-credibility block,
// injected into <div id="about-us-root">. First of a planned trust cluster
// (About Us / Security / Compliance / Privacy) that will eventually sit
// together above a page's footer; built one at a time, About Us first.
// Currently mounted on landing.html and deal-sourcing-apply.html.
//
// Follows the same pattern as nav.js: markup-only, rendered via one IIFE
// on load, no page-specific logic attached. Self-contained styles are
// injected once via a <style> tag (scoped under .about-us-section) rather
// than added to styles.css; it reads the page's existing --accent/
// --hairline/--muted/--ink/--font-head/--font-body tokens, so it re-themes
// automatically wherever it's dropped in, the same way nav.js's topbar does.
//
// Founder photos: each entry in ABOUT_US_FOUNDERS has a `photo` field. While
// it's null nothing image-related renders at all (no placeholder, no empty
// box), so the section reads as plain text. Set it to an image path (e.g.
// '/assets/founder-cameron.jpg') and that founder's paragraph gets a round
// photo beside it, no other change needed.
//
// Usage: <div id="about-us-root"></div>
//   Place a plain, non-deferred <script src="/about-us-section.js"></script>
//   tag immediately after it (same ordering reason as nav.js -- the
//   placeholder must already exist in the DOM when this script runs).

var ABOUT_US_FOUNDERS = [
  {
    name: 'Cameron Hearne',
    photo: null,
    bio: 'is the investor side of the business. Alongside a full-time career, he taught himself property investing from scratch: hours of research, real numbers, real mistakes. His goal was consistent passive income and the freedom to travel and see more of the world. That became his first live deal, a tenanted Buy-to-Let in Mansfield, run through the same numbers you\'ll see on this platform. The yield and cash flow assumptions here are the ones he used with his own money.'
  },
  {
    name: 'Nathan Millington',
    photo: null,
    bio: 'is the technical co-founder, and brings five years\' experience as a property sourcer, sourcing deals and managing refurbs and lettings for investors, before turning that hands-on experience into the calculator and tracking tools behind PROPulsion. Cameron and Nathan knew each other and had worked on deals together before building PROPulsion.'
  }
];

(function renderAboutUsSection(){
  var root = document.getElementById('about-us-root');
  if (!root) return; // no placeholder on this page -- nothing to do

  if (!document.getElementById('about-us-section-styles')) {
    var style = document.createElement('style');
    style.id = 'about-us-section-styles';
    style.textContent =
      '.about-us-section{width:100%;padding:clamp(3rem,7vw,5.5rem) 0;border-top:1px solid var(--hairline)}' +
      '.about-us-inner{max-width:760px;margin:0 auto;padding:0 1.5rem}' +
      '.about-us-section h2{font-family:var(--font-head);font-size:clamp(1.5rem,3.2vw,2.1rem);margin:0 0 1.5rem;max-width:24ch}' +
      '.about-us-section p{font-family:var(--font-body);font-size:15px;color:var(--muted);line-height:1.7;margin:0 0 1.25rem}' +
      '.about-us-section p:last-child{margin-bottom:0}' +
      // Scoped under .about-us-section so it outranks the generic
      // ".about-us-section p" rule above, which otherwise turned the label
      // grey instead of indigo.
      '.about-us-section .about-us-kicker{font-size:11.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 .75rem}' +
      '.about-us-section strong{color:var(--ink);font-weight:700}' +
      '.about-us-founder{display:flex;gap:1.25rem;align-items:flex-start;margin:0 0 1.25rem}' +
      '.about-us-founder p{margin:0}' +
      '.about-us-photo{width:72px;height:72px;border-radius:50%;object-fit:cover;flex-shrink:0}' +
      '@media(max-width:520px){.about-us-founder{flex-direction:column;gap:.75rem}}';
    document.head.appendChild(style);
  }

  function escapeHtml(s){
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  var foundersHtml = ABOUT_US_FOUNDERS.map(function(f){
    var photoHtml = f.photo
      ? '<img class="about-us-photo" src="' + escapeHtml(f.photo) + '" alt="' + escapeHtml(f.name) + '">'
      : '';
    return '<div class="about-us-founder">' + photoHtml +
      '<p><strong>' + escapeHtml(f.name) + '</strong> ' + escapeHtml(f.bio) + '</p>' +
    '</div>';
  }).join('');

  root.innerHTML =
    '<section class="about-us-section" id="about-us">' +
      '<div class="about-us-inner">' +
        '<p class="about-us-kicker">About us</p>' +
        '<h2>Built by two people with skin in the deals</h2>' +
        '<p>PROPulsion was built by two people with real money in property, not a marketing team selling a dream.</p>' +
        foundersHtml +
        '<p>We invest in the same markets we analyse, using the same numbers we\'d put our own money against. That\'s not a slogan. It\'s how the business is built.</p>' +
      '</div>' +
    '</section>';
})();
