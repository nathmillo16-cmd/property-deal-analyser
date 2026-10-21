// letter-templates.js: the outreach letter wording, shared by the Letter
// Templates page (letters.html) and the Deal page's "Email agent" button
// (saved-deals.html), so both always use the same text.
//
// The four homeowner letters (enquiry, followup, probate, offer) take
// { ownerName, propertyAddress, offerAmount, yourName, yourArea,
// yourPhone, yourEmail, buyingDirect } and return the letter body as plain
// text, from the greeting to the sign-off. letters.html adds the sender
// address, date and recipient block above it. Any empty field comes out
// as a placeholder such as [Your name] (LETTER_PLACEHOLDERS below), never
// a blank gap, so the page can highlight it and warn before sending.
// buyingDirect (default true) adds the "no agent fees" wording; when it's
// false that wording is left out. cashBuyer (default true) says "I'm a
// cash buyer" in the Direct offer letter; when it's false the letter says
// there's a mortgage agreed in principle instead. The Direct offer letter
// has no opt-out line, since the owner invited the offer.
//
// agentOffer is the one exception: it is written to the estate agent
// (not the homeowner), for the Deal page's "Email agent" button, and
// takes agentName instead of ownerName. It is not one of the letter types
// on the Letter Templates page, and it is unchanged.

var LETTER_PLACEHOLDERS = {
  propertyAddress: '[Property address]',
  offerAmount: '[Offer amount]',
  yourName: '[Your name]',
  yourArea: '[Your area]',
  yourPhone: '[Your phone]',
  yourEmail: '[Your email]',
  yourAddress: '[Your address]'
};

// Short names for each letter, used for "Letter sent: ..." on a deal.
var LETTER_TYPE_NAMES = {
  enquiry: 'Empty property enquiry',
  followup: 'Follow-up',
  probate: 'Probate',
  offer: 'Direct offer'
};

var LETTER_OPT_OUT = "If you'd rather not hear from me again, just let me know and I won't contact you.";

// Fills every empty merge field with its placeholder, works out the
// greeting name, and formats a bare number offer as pounds.
function letterValues(v) {
  var out = {};
  Object.keys(LETTER_PLACEHOLDERS).forEach(function (k) {
    var val = v && typeof v[k] === 'string' ? v[k].trim() : '';
    out[k] = val || LETTER_PLACEHOLDERS[k];
  });
  var owner = v && typeof v.ownerName === 'string' ? v.ownerName.trim() : '';
  out.greeting = owner || 'Sir or Madam';
  var amt = v && typeof v.offerAmount === 'string' ? v.offerAmount.trim() : '';
  if (/^\d[\d,]*(\.\d{1,2})?$/.test(amt)) {
    var n = Number(amt.replace(/,/g, ''));
    if (isFinite(n)) out.offerAmount = '\u00a3' + n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  }
  // How to reach the sender: whichever of phone/email is filled in. Only
  // when both are empty do both placeholders show.
  var phone = v && typeof v.yourPhone === 'string' ? v.yourPhone.trim() : '';
  var email = v && typeof v.yourEmail === 'string' ? v.yourEmail.trim() : '';
  out.contact = phone && email ? phone + ' or ' + email
    : (phone || email || LETTER_PLACEHOLDERS.yourPhone + ' or ' + LETTER_PLACEHOLDERS.yourEmail);
  out.direct = !(v && v.buyingDirect === false);
  out.cash = !(v && v.cashBuyer === false);
  return out;
}

var LETTER_TEMPLATES = {
  enquiry: (raw) => { const v = letterValues(raw); return `Dear ${v.greeting},

I hope this finds you well. My name is ${v.yourName} and I'm a local property investor based in ${v.yourArea}.

I noticed that the property at ${v.propertyAddress} has been empty for a little while, and I wanted to reach out directly in case you'd ever consider selling it. There's no obligation at all${v.direct ? ", and I'm not an agent, so there'd be no fees involved" : ''}.

If it's something you'd be open to exploring, I'd be glad to have a friendly, no-pressure chat whenever suits you. And if the timing isn't right, I completely understand.

You can reach me on ${v.contact}.

${LETTER_OPT_OUT}

Kind regards,
${v.yourName}`; },

  followup: (raw) => { const v = letterValues(raw); return `Dear ${v.greeting},

I wrote to you a little while ago about your property at ${v.propertyAddress}. I appreciate you're busy, so I just wanted to follow up gently in case my first letter didn't reach you.

If you'd ever consider selling, I'd still be very happy to talk it through, with no obligation${v.direct ? ' and no fees' : ''}.

Either way, I wish you well. You can reach me on ${v.contact}.

${LETTER_OPT_OUT}

Kind regards,
${v.yourName}`; },

  // Probate: opens with condolence, assumes nothing about the reader's
  // situation or plans, no urgency, and leaves timing entirely to them.
  probate: (raw) => { const v = letterValues(raw); return `Dear ${v.greeting},

I'm very sorry for your loss, and I hope you'll forgive me for writing at what may be a difficult time.

My name is ${v.yourName} and I'm a local property investor based in ${v.yourArea}. I'm writing about ${v.propertyAddress}, simply so you know there's someone local who would be interested in buying it, should that ever be helpful.${v.direct ? ' I buy directly, so there would be no agent fees involved.' : ''}

I don't want to presume anything about your circumstances, and there's no need to reply. If selling is ever something you'd like to talk about, I'm happy to fit around whatever timing works for you, however far ahead that may be.

If it would help to talk, you can reach me on ${v.contact}.

${LETTER_OPT_OUT}

With kind regards,
${v.yourName}`; },

  offer: (raw) => { const v = letterValues(raw); return `Dear ${v.greeting},

Thank you for taking the time to speak with me about ${v.propertyAddress}. As promised, I'm putting my offer in writing so you have it clearly.

I'd be pleased to offer ${v.offerAmount} for the property${v.direct ? ', as a direct purchase with no agent fees' : ''}. This offer is made subject to contract and survey. ${v.cash ? "I'm a cash buyer and can move at whatever pace works best for you." : 'I have a mortgage agreed in principle and can move quickly.'}

This is simply a starting point, and I'm very happy to discuss it. There's no pressure and no deadline from my side.

Whenever you're ready, you can reach me on ${v.contact}.

Kind regards,
${v.yourName}`; },

  agentOffer: (v) => `Dear ${v.agentName},

Thank you for your help with ${v.propertyAddress}. I'd like to make an offer of ${v.offerAmount} for the property, and I'd be grateful if you could put it forward to the vendor.

I'm a serious buyer and can move promptly. I'm happy to provide proof of funds or a mortgage agreement in principle, and to arrange a further viewing or survey if that would help.

Please let me know the vendor's response, or if there's anything else you need from me.

You can reach me on ${v.yourPhone} or ${v.yourEmail}.

Kind regards,
${v.yourName}`
};
