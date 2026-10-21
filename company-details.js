// company-details.js: the user's Company & letters details (Settings), in
// one place for Letter Templates and the PDFs (scope of works, and any
// future ones). Needs API_BASE from app-config.js.
//
//   CompanyDetails.fromProfile(profile)  -> details, no network
//   CompanyDetails.logo(session)          -> { data, w, h, fmt } or null
//
// details: { personName, name, number, address, phone, email, hasLogo,
//            available }  (available: false before db/057 is run)
(function () {
  function clean(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }

  function fromProfile(p) {
    p = p && typeof p === 'object' ? p : {};
    var c = p.company_details && typeof p.company_details === 'object' ? p.company_details : {};
    var person = [clean(p.name), clean(p.surname)].filter(Boolean).join(' ') || null;
    return {
      available: !!p.settings_available,
      personName: person,
      name: clean(c.name),
      number: clean(c.number),
      address: clean(c.address),
      phone: clean(c.phone),
      email: clean(c.email),
      hasLogo: !!c.logo_updated_at,
      logoVersion: c.logo_updated_at || null
    };
  }

  // Cached for the page's life; a failed fetch clears itself so the next
  // call tries again.
  var logoPromise = null;
  function logo(session) {
    if (!session) return Promise.resolve(null);
    if (!logoPromise) {
      logoPromise = (async function () {
        var res = await fetch(API_BASE + '/api/profile/company-logo', { headers: { Authorization: 'Bearer ' + session.access_token } });
        if (!res.ok) throw new Error('logo');
        var d = await res.json();
        if (!d || !d.data_url) return null;
        var dims = await new Promise(function (resolve) {
          var i = new Image();
          i.onload = function () { resolve({ w: i.naturalWidth, h: i.naturalHeight }); };
          i.onerror = function () { resolve(null); };
          i.src = d.data_url;
        });
        if (!dims || !dims.w || !dims.h) return null;
        return { data: d.data_url, w: dims.w, h: dims.h, fmt: /^data:image\/png/.test(d.data_url) ? 'PNG' : 'JPEG' };
      })().catch(function () { logoPromise = null; return null; });
    }
    return logoPromise;
  }

  window.CompanyDetails = { fromProfile: fromProfile, logo: logo };
})();
