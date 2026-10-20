// letter-templates.js: the outreach letter wording, shared by the Letter
// Templates page (letters.html) and the Deal page's "Email agent" button
// (saved-deals.html), so both always use the same text. Moved here
// unchanged from letters.html. Each template takes the merge values
// { ownerName, propertyAddress, offerAmount, yourName, yourArea,
// yourPhone, yourEmail } and returns the letter as plain text.
//
// agentOffer is the one exception: it is written to the estate agent
// (not the homeowner), for the Deal page's "Email agent" button, and
// takes agentName instead of ownerName. It is not one of the letter types
// on the Letter Templates page.

var LETTER_TEMPLATES = {
  enquiry: (v) => `Dear ${v.ownerName},

I hope this finds you well. My name is ${v.yourName} and I'm a local property investor based in ${v.yourArea}.

I noticed that the property at ${v.propertyAddress} has been empty for a little while, and I wanted to reach out directly in case you'd ever consider selling it. There's no obligation at all, and I'm not an agent, so there'd be no fees involved.

If it's something you'd be open to exploring, I'd be glad to have a friendly, no-pressure chat whenever suits you. And if the timing isn't right, I completely understand.

You can reach me on ${v.yourPhone} or ${v.yourEmail}.

Kind regards,
${v.yourName}`,

  followup: (v) => `Dear ${v.ownerName},

I wrote to you a little while ago about your property at ${v.propertyAddress}. I appreciate you're busy, so I just wanted to follow up gently in case my first letter didn't reach you.

If you'd ever consider selling, I'd still be very happy to talk it through, with no obligation and no fees. And if you'd rather I didn't write again, just let me know and I'll respect that.

Either way, I wish you well. You can reach me on ${v.yourPhone} or ${v.yourEmail}.

Kind regards,
${v.yourName}`,

  probate: (v) => `Dear ${v.ownerName},

My name is ${v.yourName} and I'm a local property investor. I understand the property at ${v.propertyAddress} may have recently passed to you, and I'm sorry if this comes at a difficult time.

I wanted to reach out quietly in case selling it would ever be helpful to you. I buy properties directly, so there are no agent fees, and I can work to whatever timescale suits you, whether that's soon or further down the line.

There's absolutely no pressure. If now isn't the right time, please do just ignore this. And if it would help to talk, I'm on ${v.yourPhone} or ${v.yourEmail} whenever you're ready.

With kind regards,
${v.yourName}`,

  offer: (v) => `Dear ${v.ownerName},

Thank you for taking the time to speak with me about ${v.propertyAddress}. As promised, I'm putting my offer in writing so you have it clearly.

I'd be pleased to offer ${v.offerAmount} for the property, as a direct purchase with no agent fees. I'm a cash buyer and can move at whatever pace works best for you.

This is simply a starting point, and I'm very happy to discuss it. There's no pressure and no deadline from my side.

Whenever you're ready, you can reach me on ${v.yourPhone} or ${v.yourEmail}.

Kind regards,
${v.yourName}`,

  agentOffer: (v) => `Dear ${v.agentName},

Thank you for your help with ${v.propertyAddress}. I'd like to make an offer of ${v.offerAmount} for the property, and I'd be grateful if you could put it forward to the vendor.

I'm a serious buyer and can move promptly. I'm happy to provide proof of funds or a mortgage agreement in principle, and to arrange a further viewing or survey if that would help.

Please let me know the vendor's response, or if there's anything else you need from me.

You can reach me on ${v.yourPhone} or ${v.yourEmail}.

Kind regards,
${v.yourName}`
};
