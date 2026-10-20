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
    bio: 'is the investor side of the business. Alongside a full-time career, he taught himself property investing from scratch: hours of research, real numbers, real mistakes. His goal was consistent passive income and the freedom to travel and see more of the world. That learning became his first live deal, a tenanted Buy-to-Let in Mansfield, run through the same numbers you\'ll see on this platform. The yield and cash flow assumptions here are the ones he used with his own money.'
  },
  {
    name: 'Nathan Millington',
    photo: null,
    bio: 'is the technical co-founder, and brings five years\' experience as a property sourcer, sourcing deals and managing refurbs and lettings for investors, before turning that hands-on experience into the calculator and tracking tools behind PROPulsion. Cameron and Nathan knew each other and had worked on deals together before building PROPulsion.'
  }
];

// ---------------------------------------------------------------------
// "The team" variant (landing page)
// ---------------------------------------------------------------------
var TEAM_ICONS = {
  building: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M8 8h3M8 12h3M8 16h3"/><path d="M2 21h20"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l2 2M15 8l2 2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
};
var LINKEDIN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4v11H3zM9.5 9.75h3.8v1.5h.06c.53-1 1.83-2.06 3.77-2.06 4.03 0 4.77 2.65 4.77 6.1v5.46h-4v-4.84c0-1.16-.02-2.64-1.61-2.64-1.61 0-1.86 1.26-1.86 2.56v4.92h-4z"/></svg>';

var TEAM_MEMBERS = [
  {
    name: 'Cameron Hearne',
    initials: 'CH',
    photo: null,
    role: 'Co-founder · Investor & Product',
    bio: "Director of Hearne Property Group, a limited-company buy-to-let and BRRR portfolio in the East Midlands. Cameron built his investment approach from the numbers up, and every assumption in PROPulsion is one he's used with his own capital.",
    credentials: [
      { icon: 'building', text: 'Director, Hearne Property Group Ltd' },
      { icon: 'pin', text: 'BTL and BRRR investor, East Midlands' },
      { icon: 'compass', text: 'Leads product and investor experience' }
    ],
    linkedin: '#'
  },
  {
    name: 'Nathan Millington',
    initials: 'NM',
    photo: null,
    role: 'Co-founder · Sourcing & Technology',
    bio: 'Nathan has spent over five years sourcing deals for investors and managing refurbs and lettings from offer to tenant. He built PROPulsion\'s analysis engine around how deals actually perform on the ground, not how they look on paper.',
    credentials: [
      { icon: 'search', text: '5+ years sourcing property for investors' },
      { icon: 'key', text: 'Refurb and lettings management' },
      { icon: 'chart', text: 'Leads technology and deal data' }
    ],
    linkedin: '#'
  }
];

function renderTeamVariant(root, escapeHtml) {
  if (!document.getElementById('team-section-styles')) {
    var style = document.createElement('style');
    style.id = 'team-section-styles';
    style.textContent =
      '.team-section{width:100%;padding:clamp(3.5rem,8vw,6rem) 0;border-top:1px solid var(--hairline)}' +
      '.team-inner{max-width:1080px;margin:0 auto;padding:0 1.5rem}' +
      '.team-head{text-align:center;max-width:640px;margin:0 auto clamp(2.25rem,5vw,3.25rem)}' +
      '.team-kicker{font-family:var(--font-body);font-size:11.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 .9rem}' +
      '.team-head h2{font-family:var(--font-head);font-size:clamp(1.75rem,3.6vw,2.5rem);line-height:1.15;letter-spacing:-.015em;color:var(--ink);margin:0 0 1rem}' +
      '.team-intro{font-family:var(--font-body);font-size:16px;line-height:1.6;color:var(--muted);margin:0}' +
      '.team-grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(1rem,2.5vw,1.75rem)}' +
      '@media(max-width:760px){.team-grid{grid-template-columns:1fr}}' +
      '.team-card{background:var(--surface,#fff);border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:clamp(1.5rem,3vw,2.25rem);' +
        'box-shadow:0 1px 2px rgba(20,20,40,.04),0 8px 24px rgba(20,20,40,.05);display:flex;flex-direction:column}' +
      '.team-top{display:flex;align-items:center;gap:1.1rem;margin:0 0 1.35rem}' +
      '.team-photo{width:76px;height:76px;border-radius:50%;flex-shrink:0;object-fit:cover;display:flex;align-items:center;justify-content:center;' +
        'background:linear-gradient(135deg,var(--accent,#4b45b2),#37317f);color:#fff;font-family:var(--font-head);font-weight:600;font-size:24px;letter-spacing:.02em;' +
        'box-shadow:0 0 0 4px rgba(75,69,178,.10)}' +
      '.team-id{min-width:0;flex:1}' +
      '.team-name{font-family:var(--font-head);font-size:20px;font-weight:600;color:var(--ink);margin:0 0 .25rem;letter-spacing:-.005em}' +
      '.team-role{font-family:var(--font-body);font-size:13px;font-weight:600;color:var(--accent);margin:0}' +
      '.team-li{flex-shrink:0;align-self:flex-start;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;' +
        'border:1px solid var(--hairline);color:var(--muted);text-decoration:none;transition:color .15s ease,border-color .15s ease,background .15s ease}' +
      '.team-li:hover{color:var(--accent);border-color:rgba(75,69,178,.35);background:rgba(75,69,178,.06)}' +
      '.team-bio{font-family:var(--font-body);font-size:15px;line-height:1.7;color:var(--muted);margin:0 0 1.5rem}' +
      '.team-creds{list-style:none;margin:auto 0 0;padding:1.25rem 0 0;border-top:1px solid var(--hairline);display:grid;gap:.75rem}' +
      '.team-creds li{display:flex;align-items:center;gap:.7rem;font-family:var(--font-body);font-size:14px;font-weight:500;color:var(--ink)}' +
      '.team-cred-icon{width:30px;height:30px;border-radius:8px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;background:rgba(75,69,178,.08);color:var(--accent)}' +
      '.team-cred-icon svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
      '@media(max-width:480px){.team-card{padding:1.35rem 1.25rem}.team-top{gap:.85rem}.team-photo{width:56px;height:56px;font-size:19px}.team-name{font-size:18px}.team-role{font-size:12.5px}.team-li{width:32px;height:32px}}' +
      '.team-close{max-width:620px;margin:clamp(2.25rem,5vw,3.25rem) auto 0;text-align:center;font-family:var(--font-head);font-size:clamp(1.05rem,2vw,1.25rem);line-height:1.55;color:var(--ink);font-weight:500}';
    document.head.appendChild(style);
  }

  var cards = TEAM_MEMBERS.map(function (m) {
    var photo = m.photo
      ? '<img class="team-photo" src="' + escapeHtml(m.photo) + '" alt="' + escapeHtml(m.name) + '">'
      : '<span class="team-photo" aria-hidden="true">' + escapeHtml(m.initials) + '</span>';
    var creds = m.credentials.map(function (c) {
      return '<li><span class="team-cred-icon"><svg viewBox="0 0 24 24" aria-hidden="true">' + TEAM_ICONS[c.icon] + '</svg></span>' + escapeHtml(c.text) + '</li>';
    }).join('');
    return '<article class="team-card">' +
      '<div class="team-top">' + photo +
        '<div class="team-id"><h3 class="team-name">' + escapeHtml(m.name) + '</h3><p class="team-role">' + escapeHtml(m.role) + '</p></div>' +
        '<a class="team-li" href="' + escapeHtml(m.linkedin) + '" target="_blank" rel="noopener" aria-label="' + escapeHtml(m.name) + ' on LinkedIn">' + LINKEDIN_SVG + '</a>' +
      '</div>' +
      '<p class="team-bio">' + escapeHtml(m.bio) + '</p>' +
      '<ul class="team-creds">' + creds + '</ul>' +
    '</article>';
  }).join('');

  root.innerHTML =
    '<section class="team-section" id="about-us">' +
      '<div class="team-inner">' +
        '<div class="team-head">' +
          '<p class="team-kicker">The team</p>' +
          '<h2>Investors first. Software second.</h2>' +
          '<p class="team-intro">We built the tool we wanted when we were analysing our own deals.</p>' +
        '</div>' +
        '<div class="team-grid">' + cards + '</div>' +
        '<p class="team-close">We invest in the same markets we analyse, using the same numbers we\'d put our own money against.</p>' +
      '</div>' +
    '</section>';
}

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

  // data-variant="team" (landing page): "The team" layout with two founder
  // cards. Other pages (deal-sourcing-apply.html) keep the full text version
  // below. Photos: set `photo` on a TEAM_MEMBERS entry to an image path and
  // it replaces the initials circle.
  if (root.dataset.variant === 'team') {
    renderTeamVariant(root, escapeHtml);
    return;
  }

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

